-- Dashboard ready views

CREATE OR REPLACE VIEW vw_county_health_profile AS
SELECT
    c.county_fips,
    c.county_name,
    c.state_name,
    h.year,
    m.measure_name,
    m.category,
    h.value,
    m.direction
FROM fact_health_measures h
JOIN dim_county c ON h.county_fips = c.county_fips
JOIN dim_health_measure m ON h.measure_id = m.measure_id;

CREATE OR REPLACE VIEW vw_county_food_access_summary AS
SELECT
    c.county_fips,
    c.county_name,
    c.state_name,
    f.year,
    SUM(f.tract_population) AS county_food_access_population,
    SUM(f.low_access_population) AS low_access_population,
    SUM(f.low_income_low_access_population) AS low_income_low_access_population,
    ROUND(
        100.0 * SUM(f.low_income_low_access_population) / NULLIF(SUM(f.tract_population), 0),
        2
    ) AS low_income_low_access_pct
FROM fact_food_access f
JOIN dim_county c ON f.county_fips = c.county_fips
GROUP BY c.county_fips, c.county_name, c.state_name, f.year;

CREATE OR REPLACE VIEW vw_executive_county_priority AS
SELECT
    c.county_fips,
    c.county_name,
    c.state_name,
    s.year,
    cp.population,
    cp.median_household_income,
    cp.poverty_rate,
    cp.uninsured_rate,
    fa.low_income_low_access_pct,
    s.health_risk_score,
    s.economic_risk_score,
    s.food_access_score,
    s.priority_score,
    s.state_priority_rank,
    s.national_priority_rank,
    s.risk_tier
FROM analytics_county_scores s
JOIN dim_county c ON s.county_fips = c.county_fips
LEFT JOIN fact_census_profile cp ON s.county_fips = cp.county_fips AND s.year = cp.year
LEFT JOIN vw_county_food_access_summary fa ON s.county_fips = fa.county_fips AND s.year = fa.year;
