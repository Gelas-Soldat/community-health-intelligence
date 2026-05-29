const { Client } = require("pg");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  };

  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    // Check which year to use
    const reqYear = event.queryStringParameters?.year
      ? parseInt(event.queryStringParameters.year)
      : null;

    let year;
    if (reqYear) {
      year = reqYear;
    } else {
      const yrRes = await client.query(
        "SELECT MAX(year) AS year FROM analytics_county_scores"
      );
      year = parseInt(yrRes.rows[0].year);
    }

    if (!year || isNaN(year)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ year: 2023, count: 0, data: [], error: "No scored data found — run populate_scores.sql" }),
      };
    }

    const res = await client.query(`
      SELECT
        s.county_fips,
        d.county_name,
        d.state_abbr,
        d.state_name,
        s.year                          AS data_year,
        ROUND(s.priority_score::numeric, 0)::float   AS priority_score,
        ROUND(s.health_risk_score::numeric, 2)::float AS health_risk_score,
        ROUND(s.economic_risk_score::numeric, 2)::float AS economic_risk_score,
        ROUND(s.food_access_score::numeric, 2)::float AS food_access_burden,
        s.national_priority_rank        AS national_rank,
        s.state_priority_rank           AS state_rank,
        s.risk_tier
      FROM analytics_county_scores s
      JOIN dim_county d USING (county_fips)
      WHERE s.year = $1
      ORDER BY s.priority_score DESC
    `, [year]);

    const results = res.rows.map(row => ({
      county_fips:         row.county_fips,
      county_name:         row.county_name,
      state_abbr:          row.state_abbr,
      state_name:          row.state_name,
      data_year:           parseInt(row.data_year),
      priority_score:      parseFloat(row.priority_score)      || 0,
      health_risk_score:   parseFloat(row.health_risk_score)   || 0,
      economic_risk_score: parseFloat(row.economic_risk_score) || 0,
      food_access_burden:  parseFloat(row.food_access_burden)  || 0,
      preventive_care_gap: 0,
      national_rank:       parseInt(row.national_rank)         || 0,
      state_rank:          parseInt(row.state_rank)            || 0,
      risk_tier:           row.risk_tier || "LOW",
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ year, count: results.length, data: results }),
    };

  } catch (err) {
    console.error("scores error:", err.message, err.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  } finally {
    await client.end().catch(() => {});
  }
};
