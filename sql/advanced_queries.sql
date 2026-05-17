-- Advanced SQL Queries

-- 1. Rank counties by priority score within each state
SELECT
    county_name,
    state_name,
    priority_score,
    RANK() OVER (PARTITION BY state_name ORDER BY priority_score DESC) AS state_rank,
    RANK() OVER (ORDER BY priority_score DESC) AS national_rank
FROM vw_executive_county_priority
WHERE year = 2025
ORDER BY national_rank;

-- 2. Identify counties with multiple risk drivers above state averages
WITH state_benchmarks AS (
    SELECT
        state_name,
        AVG(health_risk_score) AS state_health_avg,
        AVG(economic_risk_score) AS state_economic_avg,
        AVG(food_access_score) AS state_food_avg
    FROM vw_executive_county_priority
    WHERE year = 2025
    GROUP BY state_name
), flagged AS (
    SELECT
        p.*,
        CASE WHEN p.health_risk_score > b.state_health_avg THEN 1 ELSE 0 END AS high_health_risk,
        CASE WHEN p.economic_risk_score > b.state_economic_avg THEN 1 ELSE 0 END AS high_economic_risk,
        CASE WHEN p.food_access_score > b.state_food_avg THEN 1 ELSE 0 END AS high_food_access_risk
    FROM vw_executive_county_priority p
    JOIN state_benchmarks b ON p.state_name = b.state_name
    WHERE p.year = 2025
)
SELECT
    county_name,
    state_name,
    priority_score,
    high_health_risk + high_economic_risk + high_food_access_risk AS risk_driver_count,
    health_risk_score,
    economic_risk_score,
    food_access_score
FROM flagged
WHERE high_health_risk + high_economic_risk + high_food_access_risk >= 2
ORDER BY risk_driver_count DESC, priority_score DESC;

-- 3. Percentile bands for executive reporting
SELECT
    county_name,
    state_name,
    priority_score,
    NTILE(4) OVER (ORDER BY priority_score DESC) AS priority_quartile,
    CUME_DIST() OVER (ORDER BY priority_score) AS cumulative_distribution
FROM vw_executive_county_priority
WHERE year = 2025
ORDER BY priority_score DESC;
