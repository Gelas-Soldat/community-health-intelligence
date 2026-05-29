/**
 * years.js — Netlify Function
 * Returns the list of years available in the database.
 *
 * GET /api/years
 *
 * Response: { years: [2020, 2021, 2022, 2023] }
 */

const { Client } = require("pg");

exports.handler = async () => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    const result = await client.query(
      "SELECT DISTINCT year FROM fact_health_measures ORDER BY year ASC"
    );

    const years = result.rows.map(r => r.year);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ years }),
    };

  } catch (err) {
    console.error("years function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  } finally {
    await client.end();
  }
};
