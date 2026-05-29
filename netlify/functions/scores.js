const { Client } = require("pg");

const OUTCOME_IDS = ['DIABETES','OBESITY','BPHIGH','CHD','COPD','CANCER','CASTHMA','STROKE','MHLTH','PHLTH'];
const CARE_IDS    = ['CHECKUP','DENTAL','MAMMOUSE','CERVICAL','CHOLSCREEN'];

// Normalize a value to 0-100 given min/max
const norm = (v, min, max) => max === min ? 0 : Math.round(((v - min) / (max - min)) * 100 * 100) / 100;

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const client  = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    // Resolve year
    const reqYear = event.queryStringParameters?.year ? parseInt(event.queryStringParameters.year) : null;
    const yrRes   = await client.query(
      reqYear ? "SELECT $1::int AS year" : "SELECT MAX(year) AS year FROM fact_health_measures",
      reqYear ? [reqYear] : []
    );
    const year = yrRes.rows[0].year;

    // Fetch all data in parallel
    const allIds  = [...OUTCOME_IDS, ...CARE_IDS].map(id => `'${id}'`).join(',');
    const [hmRes, cpRes, faRes, dcRes] = await Promise.all([
      // Health measures — one row per county per measure
      client.query(`SELECT county_fips, measure_id, value FROM fact_health_measures WHERE year = ${year} AND measure_id IN (${allIds})`),
      // Census profile
      client.query(`SELECT county_fips, poverty_rate, uninsured_rate, median_household_income FROM fact_census_profile WHERE year = ${year}`),
      // Food access — aggregate to county
      client.query(`SELECT county_fips, SUM(low_income_low_access_population)::float / NULLIF(SUM(tract_population),0) * 100 AS food_pct FROM fact_food_access GROUP BY county_fips`),
      // Counties
      client.query(`SELECT county_fips, county_name, state_abbr, state_name FROM dim_county`),
    ]);

    // Build health score per county in JS
    // Group measures by county
    const measuresByCounty = {};
    for (const row of hmRes.rows) {
      if (!measuresByCounty[row.county_fips]) measuresByCounty[row.county_fips] = {};
      measuresByCounty[row.county_fips][row.measure_id] = parseFloat(row.value);
    }

    // Compute avg outcome and avg care per county
    const healthRaw = {};
    for (const [fips, measures] of Object.entries(measuresByCounty)) {
      const outcomeVals = OUTCOME_IDS.map(id => measures[id]).filter(v => v != null);
      const careVals    = CARE_IDS.map(id => measures[id]).filter(v => v != null);
      healthRaw[fips] = {
        outcome: outcomeVals.length ? outcomeVals.reduce((a,b) => a+b, 0) / outcomeVals.length : null,
        care:    careVals.length    ? careVals.reduce((a,b) => a+b, 0)    / careVals.length    : null,
      };
    }

    // Compute census lookup
    const censusMap = {};
    for (const row of cpRes.rows) {
      censusMap[row.county_fips] = {
        poverty:  parseFloat(row.poverty_rate)            || 0,
        uninsured:parseFloat(row.uninsured_rate)          || 0,
        income:   parseFloat(row.median_household_income) || 0,
      };
    }

    // Compute food lookup
    const foodMap = {};
    for (const row of faRes.rows) {
      foodMap[row.county_fips] = parseFloat(row.food_pct) || 0;
    }

    // Compute global min/max for normalization
    const outcomes  = Object.values(healthRaw).map(h => h.outcome).filter(v => v != null);
    const cares     = Object.values(healthRaw).map(h => h.care).filter(v => v != null);
    const poverties = cpRes.rows.map(r => parseFloat(r.poverty_rate)).filter(v => !isNaN(v));
    const unins     = cpRes.rows.map(r => parseFloat(r.uninsured_rate)).filter(v => !isNaN(v));
    const incomes   = cpRes.rows.map(r => parseFloat(r.median_household_income)).filter(v => !isNaN(v));
    const foods     = faRes.rows.map(r => parseFloat(r.food_pct)).filter(v => !isNaN(v));

    const minMax = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr) });
    const outMM  = minMax(outcomes);
    const careMM = minMax(cares);
    const povMM  = minMax(poverties);
    const insMM  = minMax(unins);
    const incMM  = minMax(incomes);
    const foodMM = minMax(foods);

    // Build results
    const results = [];
    for (const county of dcRes.rows) {
      const fips = county.county_fips;
      const h = healthRaw[fips];
      const c = censusMap[fips];
      const f = foodMap[fips];

      if (!h && !c && f == null) continue;

      // Health risk: higher outcome avg = worse = higher score
      const healthScore = h?.outcome != null ? norm(h.outcome, outMM.min, outMM.max) : 0;
      // Care gap: lower care avg = worse = higher gap score (inverted)
      const careGap     = h?.care != null ? norm(careMM.max - h.care + careMM.min, careMM.min, careMM.max) : 0;
      // Economic risk
      const econScore   = c ? (
        0.50 * norm(c.poverty,   povMM.min, povMM.max) +
        0.30 * norm(c.uninsured, insMM.min, insMM.max) +
        0.20 * norm(incMM.max - c.income + incMM.min, incMM.min, incMM.max)
      ) : 0;
      // Food burden
      const foodScore = f != null ? norm(f, foodMM.min, foodMM.max) : 0;

      if (healthScore === 0 && econScore === 0 && foodScore === 0) continue;

      const priority = Math.round((healthScore * 0.40) + (econScore * 0.35) + (foodScore * 0.25));
      const tier = priority >= 75 ? "HIGH" : priority >= 50 ? "ELEVATED" : priority >= 25 ? "MODERATE" : "LOW";

      results.push({
        county_fips:         fips,
        county_name:         county.county_name,
        state_abbr:          county.state_abbr,
        state_name:          county.state_name,
        data_year:           year,
        priority_score:      priority,
        health_risk_score:   Math.round(healthScore * 100) / 100,
        economic_risk_score: Math.round(econScore   * 100) / 100,
        food_access_burden:  Math.round(foodScore   * 100) / 100,
        preventive_care_gap: Math.round(careGap     * 100) / 100,
        risk_tier:           tier,
      });
    }

    results.sort((a, b) => b.priority_score - a.priority_score);
    results.forEach((r, i) => { r.national_rank = i + 1; });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ year, count: results.length, data: results }),
    };

  } catch (err) {
    console.error("scores error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end();
  }
};
