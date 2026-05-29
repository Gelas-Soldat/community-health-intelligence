const { Client } = require("pg");

const r2  = (v) => Math.round(v * 100) / 100;
const n   = (v) => { const f = parseFloat(v); return isNaN(f) ? 0 : f; };

// Inlined directly into SQL to avoid pg array parameter issues
const OUTCOME_IDS  = `'DIABETES','OBESITY','BPHIGH','CHD','COPD','CANCER','CASTHMA','STROKE','MHLTH','PHLTH'`;
const CARE_IDS     = `'CHECKUP','DENTAL','MAMMOUSE','CERVICAL','CHOLSCREEN'`;
const ALL_IDS      = `${OUTCOME_IDS},${CARE_IDS}`;

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    const requestedYear = event.queryStringParameters?.year
      ? parseInt(event.queryStringParameters.year)
      : null;

    const yearResult = await client.query(
      requestedYear
        ? "SELECT $1::int AS year"
        : "SELECT MAX(year) AS year FROM fact_health_measures",
      requestedYear ? [requestedYear] : []
    );
    const year = yearResult.rows[0].year;

    const healthSQL = `
      WITH health_raw AS (
        SELECT
          county_fips,
          AVG(CASE WHEN measure_id IN (${OUTCOME_IDS}) THEN value END) AS outcome_avg,
          AVG(CASE WHEN measure_id IN (${CARE_IDS})    THEN value END) AS care_avg
        FROM fact_health_measures
        WHERE year = ${year} AND measure_id IN (${ALL_IDS})
        GROUP BY county_fips
      ),
      mm AS (
        SELECT MIN(outcome_avg) out_min, MAX(outcome_avg) out_max,
               MIN(care_avg)   care_min, MAX(care_avg)   care_max
        FROM health_raw
      )
      SELECT
        h.county_fips,
        100.0 * (h.outcome_avg - m.out_min) / NULLIF(m.out_max - m.out_min, 0) AS health_risk_score,
        100.0 * (1 - (h.care_avg - m.care_min) / NULLIF(m.care_max - m.care_min, 0)) AS preventive_care_gap
      FROM health_raw h CROSS JOIN mm m
    `;

    const economicSQL = `
      WITH econ_raw AS (
        SELECT county_fips, poverty_rate, uninsured_rate, median_household_income
        FROM fact_census_profile WHERE year = ${year}
      ),
      mm AS (
        SELECT MIN(poverty_rate) pov_min, MAX(poverty_rate) pov_max,
               MIN(uninsured_rate) ins_min, MAX(uninsured_rate) ins_max,
               MIN(median_household_income) inc_min, MAX(median_household_income) inc_max
        FROM econ_raw
      )
      SELECT
        e.county_fips,
        50.0 * (e.poverty_rate   - m.pov_min) / NULLIF(m.pov_max - m.pov_min, 0)
        + 30.0 * (e.uninsured_rate - m.ins_min) / NULLIF(m.ins_max - m.ins_min, 0)
        + 20.0 * (1 - (e.median_household_income - m.inc_min) / NULLIF(m.inc_max - m.inc_min, 0))
        AS economic_risk_score
      FROM econ_raw e CROSS JOIN mm m
    `;

    const foodSQL = `
      WITH food_raw AS (
        SELECT county_fips,
          SUM(low_income_low_access_population)::float
            / NULLIF(SUM(tract_population), 0) * 100 AS food_burden_pct
        FROM fact_food_access GROUP BY county_fips
      ),
      mm AS (SELECT MIN(food_burden_pct) f_min, MAX(food_burden_pct) f_max FROM food_raw)
      SELECT f.county_fips,
        100.0 * (f.food_burden_pct - m.f_min) / NULLIF(m.f_max - m.f_min, 0) AS food_access_burden
      FROM food_raw f CROSS JOIN mm m
    `;

    const [healthRes, economicRes, foodRes, countyRes] = await Promise.all([
      client.query(healthSQL),
      client.query(economicSQL),
      client.query(foodSQL),
      client.query("SELECT county_fips, county_name, state_abbr, state_name FROM dim_county"),
    ]);

    const healthMap   = Object.fromEntries(healthRes.rows.map(r  => [r.county_fips, r]));
    const economicMap = Object.fromEntries(economicRes.rows.map(r => [r.county_fips, r]));
    const foodMap     = Object.fromEntries(foodRes.rows.map(r    => [r.county_fips, r]));

    const results = [];

    for (const county of countyRes.rows) {
      const fips = county.county_fips;
      const h = healthMap[fips];
      const e = economicMap[fips];
      const f = foodMap[fips];

      if (!h && !e && !f) continue;

      const healthScore   = r2(n(h?.health_risk_score));
      const economicScore = r2(n(e?.economic_risk_score));
      const foodScore     = r2(n(f?.food_access_burden));
      const careGap       = r2(n(h?.preventive_care_gap));

      if (healthScore === 0 && economicScore === 0 && foodScore === 0) continue;

      const priority = Math.round(
        (healthScore * 0.40) + (economicScore * 0.35) + (foodScore * 0.25)
      );

      const tier =
        priority >= 75 ? "HIGH"     :
        priority >= 50 ? "ELEVATED" :
        priority >= 25 ? "MODERATE" : "LOW";

      results.push({
        county_fips:         fips,
        county_name:         county.county_name,
        state_abbr:          county.state_abbr,
        state_name:          county.state_name,
        data_year:           year,
        priority_score:      priority,
        health_risk_score:   healthScore,
        economic_risk_score: economicScore,
        food_access_burden:  foodScore,
        preventive_care_gap: careGap,
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
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  } finally {
    await client.end();
  }
};
