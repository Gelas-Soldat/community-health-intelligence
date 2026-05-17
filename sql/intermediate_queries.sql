-- Intermediate SQL Queries

-- 1. Counties where diabetes and poverty are both above practical concern thresholds
SELECT
    c.county_name,
    c.state_name,
    h.value AS diabetes_rate,
    cp.poverty_rate,
    cp.uninsured_rate
FROM fact_health_measures h
JOIN dim_health_measure m ON h.measure_id = m.measure_id
JOIN fact_census_profile cp ON h.county_fips = cp.county_fips AND h.year = cp.year
JOIN dim_county c ON h.county_fips = c.county_fips
WHERE m.measure_id = 'DIABETES'
  AND h.value > 12
  AND cp.poverty_rate > 18
ORDER BY h.value DESC, cp.poverty_rate DESC;

-- 2. Compare county diabetes rates to state average using a CTE
WITH state_avg AS (
    SELECT
        c.state_name,
        AVG(h.value) AS avg_diabetes_rate
    FROM fact_health_measures h
    JOIN dim_county c ON h.county_fips = c.county_fips
    WHERE h.measure_id = 'DIABETES'
    GROUP BY c.state_name
)
SELECT
    c.county_name,
    c.state_name,
    h.value AS county_diabetes_rate,
    ROUND(sa.avg_diabetes_rate, 2) AS state_avg_diabetes_rate,
    ROUND(h.value - sa.avg_diabetes_rate, 2) AS gap_vs_state
FROM fact_health_measures h
JOIN dim_county c ON h.county_fips = c.county_fips
JOIN state_avg sa ON c.state_name = sa.state_name
WHERE h.measure_id = 'DIABETES'
ORDER BY gap_vs_state DESC;

-- 3. Food access burden by county
SELECT
    county_name,
    state_name,
    low_income_low_access_pct
FROM vw_county_food_access_summary
ORDER BY low_income_low_access_pct DESC
LIMIT 25;
