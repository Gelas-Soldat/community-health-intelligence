-- Beginner SQL Queries

-- 1. View counties loaded by state
SELECT state_name, COUNT(*) AS county_count
FROM dim_county
GROUP BY state_name
ORDER BY county_count DESC;

-- 2. Average health measure by state
SELECT
    c.state_name,
    m.measure_name,
    ROUND(AVG(h.value), 2) AS avg_value
FROM fact_health_measures h
JOIN dim_county c ON h.county_fips = c.county_fips
JOIN dim_health_measure m ON h.measure_id = m.measure_id
WHERE h.year = 2025
GROUP BY c.state_name, m.measure_name
ORDER BY c.state_name, avg_value DESC;

-- 3. Top counties by poverty rate
SELECT
    c.county_name,
    c.state_name,
    cp.poverty_rate
FROM fact_census_profile cp
JOIN dim_county c ON cp.county_fips = c.county_fips
ORDER BY cp.poverty_rate DESC
LIMIT 25;
