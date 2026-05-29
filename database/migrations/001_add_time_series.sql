-- =============================================================================
-- Migration 001: Add Time-Series Support
-- Community Health Intelligence
-- Rewritten to match actual schema (fact_health_measures, fact_census_profile,
-- fact_food_access, dim_county, analytics_county_scores)
--
-- NOTE: The fact tables already have a `year` column — no ALTER TABLE needed.
-- This migration adds:
--   1. data_loads   — tracks what years/sources have been ingested
--   2. county_score_trends — pre-computed YoY deltas
--   3. Four views for the dashboard and API layer
--   4. compute_trends() stored procedure
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Track what has been loaded so the pipeline is resumable
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_loads (
    id           SERIAL PRIMARY KEY,
    source       TEXT        NOT NULL,  -- 'cdc_places', 'census_acs', 'food_access'
    year         INTEGER     NOT NULL,
    state_fips   TEXT,                  -- NULL = national file
    record_count INTEGER,
    loaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes        TEXT,
    UNIQUE (source, year, state_fips)
);

-- ---------------------------------------------------------------------------
-- 2. Pre-computed year-over-year score deltas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS county_score_trends (
    county_fips            TEXT     NOT NULL,
    year_current           INTEGER  NOT NULL,
    year_prior             INTEGER  NOT NULL,
    priority_score_delta   NUMERIC(10,4),
    health_delta           NUMERIC(10,4),
    economic_delta         NUMERIC(10,4),
    food_access_delta      NUMERIC(10,4),
    trend_direction        TEXT GENERATED ALWAYS AS (
        CASE
            WHEN priority_score_delta >  2 THEN 'WORSENING'
            WHEN priority_score_delta < -2 THEN 'IMPROVING'
            ELSE 'STABLE'
        END
    ) STORED,
    PRIMARY KEY (county_fips, year_current),
    FOREIGN KEY (county_fips) REFERENCES dim_county(county_fips)
);

CREATE INDEX IF NOT EXISTS idx_trends_direction
    ON county_score_trends (trend_direction, year_current);

-- ---------------------------------------------------------------------------
-- 3. Views
-- ---------------------------------------------------------------------------

-- Latest scored year per county — default dashboard view
CREATE OR REPLACE VIEW v_latest_scores AS
WITH latest_year AS (
    SELECT MAX(year) AS yr FROM analytics_county_scores
)
SELECT
    s.county_fips,
    s.year,
    s.health_risk_score,
    s.economic_risk_score,
    s.food_access_score,
    s.priority_score,
    s.state_priority_rank,
    s.national_priority_rank,
    s.risk_tier,
    c.county_name,
    c.state_fips,
    c.state_abbr,
    c.state_name,
    c.region,
    t.priority_score_delta,
    t.trend_direction
FROM analytics_county_scores s
JOIN dim_county c USING (county_fips)
LEFT JOIN county_score_trends t
       ON t.county_fips    = s.county_fips
      AND t.year_current   = s.year
CROSS JOIN latest_year
WHERE s.year = latest_year.yr;

-- All years for every county — used by the map year selector
CREATE OR REPLACE VIEW v_score_history AS
SELECT
    s.county_fips,
    s.year,
    s.health_risk_score,
    s.economic_risk_score,
    s.food_access_score,
    s.priority_score,
    s.risk_tier,
    c.county_name,
    c.state_abbr
FROM analytics_county_scores s
JOIN dim_county c USING (county_fips)
ORDER BY s.county_fips, s.year;

-- Most worsening / improving counties — "Counties to Watch" section
CREATE OR REPLACE VIEW v_county_trends AS
SELECT
    t.county_fips,
    c.county_name,
    c.state_abbr,
    t.year_current,
    t.year_prior,
    t.priority_score_delta,
    t.trend_direction,
    s.priority_score   AS current_score,
    s.risk_tier        AS current_tier
FROM county_score_trends t
JOIN dim_county c ON c.county_fips = t.county_fips
JOIN analytics_county_scores s
     ON s.county_fips = t.county_fips
    AND s.year        = t.year_current
WHERE t.year_current = (SELECT MAX(year_current) FROM county_score_trends)
ORDER BY ABS(t.priority_score_delta) DESC;

-- State-level aggregates per year — used by state filter in UI
CREATE OR REPLACE VIEW v_state_risk_summary AS
SELECT
    c.state_fips,
    c.state_abbr,
    c.state_name,
    s.year,
    COUNT(*)                                                    AS county_count,
    ROUND(AVG(s.priority_score)::NUMERIC, 2)                   AS avg_priority_score,
    ROUND(AVG(s.health_risk_score)::NUMERIC, 2)                AS avg_health_score,
    ROUND(AVG(s.economic_risk_score)::NUMERIC, 2)              AS avg_economic_score,
    ROUND(AVG(s.food_access_score)::NUMERIC, 2)                AS avg_food_score,
    COUNT(*) FILTER (WHERE s.risk_tier = 'HIGH')               AS high_risk_counties,
    COUNT(*) FILTER (WHERE s.risk_tier = 'ELEVATED')           AS elevated_risk_counties
FROM analytics_county_scores s
JOIN dim_county c USING (county_fips)
GROUP BY c.state_fips, c.state_abbr, c.state_name, s.year;

-- ---------------------------------------------------------------------------
-- 4. compute_trends(year) — call after each annual data load
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE compute_trends(p_year INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
    v_year_prior INTEGER;
    v_rows       INTEGER;
BEGIN
    SELECT MAX(year)
      INTO v_year_prior
      FROM analytics_county_scores
     WHERE year < p_year;

    IF v_year_prior IS NULL THEN
        RAISE NOTICE 'No prior year found — trend computation skipped.';
        RETURN;
    END IF;

    RAISE NOTICE 'Computing trends: % vs %', p_year, v_year_prior;

    DELETE FROM county_score_trends WHERE year_current = p_year;

    INSERT INTO county_score_trends (
        county_fips,
        year_current,
        year_prior,
        priority_score_delta,
        health_delta,
        economic_delta,
        food_access_delta
    )
    SELECT
        curr.county_fips,
        p_year,
        v_year_prior,
        ROUND((curr.priority_score    - prior.priority_score)::NUMERIC,    4),
        ROUND((curr.health_risk_score - prior.health_risk_score)::NUMERIC, 4),
        ROUND((curr.economic_risk_score - prior.economic_risk_score)::NUMERIC, 4),
        ROUND((curr.food_access_score - prior.food_access_score)::NUMERIC, 4)
    FROM analytics_county_scores curr
    JOIN analytics_county_scores prior
      ON prior.county_fips = curr.county_fips
     AND prior.year        = v_year_prior
    WHERE curr.year = p_year;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE 'Trend rows inserted: %', v_rows;
END;
$$;

COMMIT;
