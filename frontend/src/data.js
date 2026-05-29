/**
 * data.js — Live data fetching from Netlify Functions
 *
 * Replaces the hardcoded countyData array.
 * Functions run at /api/scores and /api/years via netlify.toml redirects.
 */

const API_BASE = import.meta.env.DEV
  ? "http://localhost:8888/.netlify/functions"
  : "/.netlify/functions";

export async function fetchScores(year = null) {
  const url = year
    ? `${API_BASE}/scores?year=${year}`
    : `${API_BASE}/scores`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`scores API error: ${resp.status}`);
  const json = await resp.json();
  return json.data;
}

export async function fetchYears() {
  const resp = await fetch(`${API_BASE}/years`);
  if (!resp.ok) throw new Error(`years API error: ${resp.status}`);
  const json = await resp.json();
  return json.years;
}

// Fallback static data for local dev without the functions running
export const countyData = [
  {
    county_fips: "47157", county_name: "Shelby County", state_abbr: "TN",
    data_year: 2023, priority_score: 86, health_risk_score: 82,
    economic_risk_score: 79, food_access_burden: 88,
    preventive_care_gap: 74, risk_tier: "HIGH",
  },
  {
    county_fips: "47037", county_name: "Davidson County", state_abbr: "TN",
    data_year: 2023, priority_score: 74, health_risk_score: 71,
    economic_risk_score: 66, food_access_burden: 72,
    preventive_care_gap: 61, risk_tier: "ELEVATED",
  },
  {
    county_fips: "47109", county_name: "Madison County", state_abbr: "TN",
    data_year: 2023, priority_score: 81, health_risk_score: 78,
    economic_risk_score: 76, food_access_burden: 84,
    preventive_care_gap: 70, risk_tier: "HIGH",
  },
  {
    county_fips: "47093", county_name: "Knox County", state_abbr: "TN",
    data_year: 2023, priority_score: 68, health_risk_score: 64,
    economic_risk_score: 58, food_access_burden: 69,
    preventive_care_gap: 52, risk_tier: "MODERATE",
  },
  {
    county_fips: "47065", county_name: "Hamilton County", state_abbr: "TN",
    data_year: 2023, priority_score: 72, health_risk_score: 70,
    economic_risk_score: 63, food_access_burden: 75,
    preventive_care_gap: 58, risk_tier: "ELEVATED",
  },
];
