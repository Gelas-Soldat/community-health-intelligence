-- Refresh county scoring table
-- This version uses simple min max normalization so the method is easy to explain in interviews.

CREATE OR REPLACE PROCEDURE refresh_county_priority_scores(target_year INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM analytics_county_scores WHERE year = target_year;

    INSERT INTO analytics_county_scores (
        county_fips,
        year,
        health_risk_score,
        economic_risk_score,
        food_access_score,
        priority_score,
        state_priority_rank,
        national_priority_rank,
        risk_tier
    )
    WITH health_base AS (
        SELECT
            h.county_fips,
            AVG(h.value) FILTER (
                WHERE h.measure_id IN ('DIABETES', 'OBESITY', 'CSMOKING', 'BPHIGH', 'LPA')
            ) AS raw_health_score
        FROM fact_health_measures h
        WHERE h.year = target_year
        GROUP BY h.county_fips
    ),
    food_base AS (
        SELECT
            county_fips,
            ROUND(100.0 * SUM(low_income_low_access_population) / NULLIF(SUM(tract_population), 0), 4) AS raw_food_score
        FROM fact_food_access
        WHERE year = target_year
        GROUP BY county_fips
    ),
    combined AS (
        SELECT
            c.county_fips,
            c.state_name,
            hb.raw_health_score,
            ((cp.poverty_rate * 0.50) + (cp.uninsured_rate * 0.35) + (cp.no_vehicle_household_rate * 0.15)) AS raw_economic_score,
            fb.raw_food_score
        FROM dim_county c
        LEFT JOIN health_base hb ON c.county_fips = hb.county_fips
        LEFT JOIN fact_census_profile cp ON c.county_fips = cp.county_fips AND cp.year = target_year
        LEFT JOIN food_base fb ON c.county_fips = fb.county_fips
    ),
    normalized AS (
        SELECT
            *,
            100.0 * (raw_health_score - MIN(raw_health_score) OVER()) / NULLIF(MAX(raw_health_score) OVER() - MIN(raw_health_score) OVER(), 0) AS health_risk_score,
            100.0 * (raw_economic_score - MIN(raw_economic_score) OVER()) / NULLIF(MAX(raw_economic_score) OVER() - MIN(raw_economic_score) OVER(), 0) AS economic_risk_score,
            100.0 * (raw_food_score - MIN(raw_food_score) OVER()) / NULLIF(MAX(raw_food_score) OVER() - MIN(raw_food_score) OVER(), 0) AS food_access_score
        FROM combined
    ),
    scored AS (
        SELECT
            county_fips,
            state_name,
            target_year AS year,
            ROUND(health_risk_score, 4) AS health_risk_score,
            ROUND(economic_risk_score, 4) AS economic_risk_score,
            ROUND(food_access_score, 4) AS food_access_score,
            ROUND((health_risk_score * 0.50) + (economic_risk_score * 0.30) + (food_access_score * 0.20), 4) AS priority_score
        FROM normalized
    ),
    ranked AS (
        SELECT
            *,
            RANK() OVER (PARTITION BY state_name ORDER BY priority_score DESC) AS state_priority_rank,
            RANK() OVER (ORDER BY priority_score DESC) AS national_priority_rank
        FROM scored
    )
    SELECT
        county_fips,
        year,
        health_risk_score,
        economic_risk_score,
        food_access_score,
        priority_score,
        state_priority_rank,
        national_priority_rank,
        CASE
            WHEN priority_score >= 80 THEN 'Critical'
            WHEN priority_score >= 60 THEN 'High'
            WHEN priority_score >= 40 THEN 'Moderate'
            ELSE 'Lower'
        END AS risk_tier
    FROM ranked;
END;
$$;
