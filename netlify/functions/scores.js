const { Client } = require("pg");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const client  = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    const reqYear = event.queryStringParameters?.year ? parseInt(event.queryStringParameters.year) : null;
    const yrRes   = await client.query(
      reqYear ? "SELECT $1::int AS year" : "SELECT MAX(year) AS year FROM fact_health_measures",
      reqYear ? [reqYear] : []
    );
    const year = parseInt(yrRes.rows[0].year);

    const sql = `
      WITH
      health_outcome AS (
        SELECT county_fips, AVG(value)::numeric AS outcome_avg
        FROM fact_health_measures
        WHERE year = ${year}
          AND measure_id IN ('DIABETES','OBESITY','BPHIGH','CHD','COPD','CANCER','CASTHMA','STROKE','MHLTH','PHLTH')
        GROUP BY county_fips
      ),
      health_care AS (
        SELECT county_fips, AVG(value)::numeric AS care_avg
        FROM fact_health_measures
        WHERE year = ${year}
          AND measure_id IN ('CHECKUP','DENTAL','MAMMOUSE','CERVICAL','CHOLSCREEN')
        GROUP BY county_fips
      ),
      health_scored AS (
        SELECT h.county_fips,
          CASE WHEN MAX(h.outcome_avg) OVER () = MIN(h.outcome_avg) OVER () THEN 0
               ELSE 100::numeric * (h.outcome_avg - MIN(h.outcome_avg) OVER ())
                    / (MAX(h.outcome_avg) OVER () - MIN(h.outcome_avg) OVER ())
          END AS health_risk_score,
          CASE WHEN MAX(c.care_avg) OVER () = MIN(c.care_avg) OVER () THEN 0
               ELSE 100::numeric * (1 - (c.care_avg - MIN(c.care_avg) OVER ())
                    / (MAX(c.care_avg) OVER () - MIN(c.care_avg) OVER ()))
          END AS preventive_care_gap
        FROM health_outcome h
        LEFT JOIN health_care c USING (county_fips)
      ),
      econ_scored AS (
        SELECT e.county_fips,
          (
            50::numeric * CASE WHEN MAX(e.poverty_rate) OVER () = MIN(e.poverty_rate) OVER () THEN 0
              ELSE (e.poverty_rate - MIN(e.poverty_rate) OVER ()) / (MAX(e.poverty_rate) OVER () - MIN(e.poverty_rate) OVER ()) END
            + 30::numeric * CASE WHEN MAX(e.uninsured_rate) OVER () = MIN(e.uninsured_rate) OVER () THEN 0
              ELSE (e.uninsured_rate - MIN(e.uninsured_rate) OVER ()) / (MAX(e.uninsured_rate) OVER () - MIN(e.uninsured_rate) OVER ()) END
            + 20::numeric * CASE WHEN MAX(e.median_household_income) OVER () = MIN(e.median_household_income) OVER () THEN 0
              ELSE 1 - (e.median_household_income - MIN(e.median_household_income) OVER ()) / (MAX(e.median_household_income) OVER () - MIN(e.median_household_income) OVER ()) END
          ) AS economic_risk_score
        FROM fact_census_profile e WHERE year = ${year}
      ),
      food_raw AS (
        SELECT county_fips,
          SUM(low_income_low_access_population)::numeric
            / NULLIF(SUM(tract_population), 0)::numeric * 100 AS food_pct
        FROM fact_food_access GROUP BY county_fips
      ),
      food_scored AS (
        SELECT county_fips,
          CASE WHEN MAX(food_pct) OVER () = MIN(food_pct) OVER () THEN 0
               ELSE 100::numeric * (food_pct - MIN(food_pct) OVER ())
                    / (MAX(food_pct) OVER () - MIN(food_pct) OVER ())
          END AS food_access_burden
        FROM food_raw
      )
      SELECT
        d.county_fips, d.county_name, d.state_abbr, d.state_name,
        COALESCE(hs.health_risk_score,   0)::float AS health_risk_score,
        COALESCE(hs.preventive_care_gap, 0)::float AS preventive_care_gap,
        COALESCE(es.economic_risk_score, 0)::float AS economic_risk_score,
        COALESCE(fs.food_access_burden,  0)::float AS food_access_burden
      FROM dim_county d
      LEFT JOIN health_scored hs USING (county_fips)
      LEFT JOIN econ_scored   es USING (county_fips)
      LEFT JOIN food_scored   fs USING (county_fips)
    `;

    const res = await client.query(sql);
    const results = [];

    for (const row of res.rows) {
      const h = parseFloat(row.health_risk_score)   || 0;
      const e = parseFloat(row.economic_risk_score) || 0;
      const f = parseFloat(row.food_access_burden)  || 0;
      const c = parseFloat(row.preventive_care_gap) || 0;

      if (h === 0 && e === 0 && f === 0) continue;

      const priority = Math.round((h * 0.40) + (e * 0.35) + (f * 0.25));

      // Adjusted thresholds based on actual national score distribution
      const tier = priority >= 50 ? "HIGH"
                 : priority >= 35 ? "ELEVATED"
                 : priority >= 20 ? "MODERATE"
                 : "LOW";

      results.push({
        county_fips:         row.county_fips,
        county_name:         row.county_name,
        state_abbr:          row.state_abbr,
        state_name:          row.state_name,
        data_year:           year,
        priority_score:      priority,
        health_risk_score:   Math.round(h * 100) / 100,
        economic_risk_score: Math.round(e * 100) / 100,
        food_access_burden:  Math.round(f * 100) / 100,
        preventive_care_gap: Math.round(c * 100) / 100,
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
