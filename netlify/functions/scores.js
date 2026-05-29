/**
 * scores.js — Netlify Function
 * Returns county risk scores for the map.
 *
 * GET /api/scores?year=2023
 * GET /api/scores          (returns latest year)
 *
 * Computes priority score on the fly from the three fact tables
 * using the same weighting as the scoring methodology:
 *   40% health risk + 35% economic risk + 25% food access burden
 */

const { Client } = require("pg");

// Health measures that contribute to the health risk score
// Higher value = worse outcome for all of these
const HEALTH_MEASURES = [
  "DIABETES", "OBESITY", "BPHIGH", "CHD", "COPD",
  "CANCER", "CASTHMA", "STROKE", "MHLTH", "PHLTH",
];

// Preventive care measures — higher is BETTER, so we invert
const CARE_MEASURES = [
  "CHECKUP", "DENTAL", "MAMMOUSE", "CERVICAL", "CHOLSCREEN",
];

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    // Resolve year — use requested year or latest available
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

    // Pull health risk scores per county
    // Average the crude prevalence values for our outcome measures,
    // then normalize to 0-100 using min/max across all counties
    const healthSQL = `
      WITH health_raw AS (
        SELECT
          county_fips,
          AVG(CASE WHEN measure_id = ANY($1) THEN value END)   AS outcome_avg,
          AVG(CASE WHEN measure_id = ANY($2) THEN value END)   AS care_avg
        FROM fact_health_measures
        WHERE year = $3
          AND measure_id = ANY($4)
        GROUP BY county_fips
      ),
      health_minmax AS (
        SELECT
          MIN(outcome_avg) AS out_min, MAX(outcome_avg) AS out_max,
          MIN(care_avg)    AS care_min, MAX(care_avg)   AS care_max
        FROM health_raw
      )
      SELECT
        h.county_fips,
        -- Normalize outcome (higher = worse = higher score)
        ROUND(
          100.0 * (h.outcome_avg - m.out_min)
               / NULLIF(m.out_max - m.out_min, 0)
        ::numeric, 2) AS health_risk_score,
        -- Normalize care gap (lower care = higher gap score, so invert)
        ROUND(
          100.0 * (1 - (h.care_avg - m.care_min)
               / NULLIF(m.care_max - m.care_min, 0))
        ::numeric, 2) AS preventive_care_gap
      FROM health_raw h
      CROSS JOIN health_minmax m
    `;

    // Pull economic risk scores per county
    const economicSQL = `
      WITH econ_raw AS (
        SELECT
          county_fips,
          poverty_rate,
          uninsured_rate,
          median_household_income
        FROM fact_census_profile
        WHERE year = $1
      ),
      econ_minmax AS (
        SELECT
          MIN(poverty_rate)            AS pov_min,  MAX(poverty_rate)            AS pov_max,
          MIN(uninsured_rate)          AS ins_min,  MAX(uninsured_rate)          AS ins_max,
          MIN(median_household_income) AS inc_min,  MAX(median_household_income) AS inc_max
        FROM econ_raw
      )
      SELECT
        e.county_fips,
        ROUND(
          (
            -- poverty normalized (higher = worse)
            50.0 * (e.poverty_rate - m.pov_min)
                 / NULLIF(m.pov_max - m.pov_min, 0)
            +
            -- uninsured normalized (higher = worse)
            30.0 * (e.uninsured_rate - m.ins_min)
                 / NULLIF(m.ins_max - m.ins_min, 0)
            +
            -- income normalized and inverted (lower income = higher risk)
            20.0 * (1 - (e.median_household_income - m.inc_min)
                      / NULLIF(m.inc_max - m.inc_min, 0))
          )
        ::numeric, 2) AS economic_risk_score
      FROM econ_raw e
      CROSS JOIN econ_minmax m
    `;

    // Pull food access burden per county
    // % of tracts in the county that are low income + low access
    const foodSQL = `
      WITH food_raw AS (
        SELECT
          county_fips,
          SUM(low_income_low_access_population)::float
            / NULLIF(SUM(tract_population), 0) * 100 AS food_burden_pct
        FROM fact_food_access
        GROUP BY county_fips
      ),
      food_minmax AS (
        SELECT MIN(food_burden_pct) AS f_min, MAX(food_burden_pct) AS f_max
        FROM food_raw
      )
      SELECT
        f.county_fips,
        ROUND(
          100.0 * (f.food_burden_pct - m.f_min)
               / NULLIF(m.f_max - m.f_min, 0)
        ::numeric, 2) AS food_access_burden
      FROM food_raw f
      CROSS JOIN food_minmax m
    `;

    const [healthRes, economicRes, foodRes] = await Promise.all([
      client.query(healthSQL, [
        HEALTH_MEASURES,
        CARE_MEASURES,
        year,
        [...HEALTH_MEASURES, ...CARE_MEASURES],
      ]),
      client.query(economicSQL, [year]),
      client.query(foodSQL),
    ]);

    // Build lookup maps
    const healthMap   = Object.fromEntries(healthRes.rows.map(r => [r.county_fips, r]));
    const economicMap = Object.fromEntries(economicRes.rows.map(r => [r.county_fips, r]));
    const foodMap     = Object.fromEntries(foodRes.rows.map(r => [r.county_fips, r]));

    // Get county metadata
    const countyRes = await client.query(
      "SELECT county_fips, county_name, state_abbr, state_name FROM dim_county"
    );

    // Assemble final scores
    const results = [];

    for (const county of countyRes.rows) {
      const fips = county.county_fips;
      const h    = healthMap[fips];
      const e    = economicMap[fips];
      const f    = foodMap[fips];

      // Skip counties missing all three sources
      if (!h && !e && !f) continue;

      const healthScore   = parseFloat(h?.health_risk_score   ?? 0);
      const economicScore = parseFloat(e?.economic_risk_score ?? 0);
      const foodScore     = parseFloat(f?.food_access_burden  ?? 0);
      const careGap       = parseFloat(h?.preventive_care_gap ?? 0);

      // Weighted priority score
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

    // Sort by priority descending
    results.sort((a, b) => b.priority_score - a.priority_score);

    // Add national rank
    results.forEach((r, i) => { r.national_rank = i + 1; });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ year, count: results.length, data: results }),
    };

  } catch (err) {
    console.error("scores function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  } finally {
    await client.end();
  }
};
