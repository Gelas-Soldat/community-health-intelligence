-- =============================================================================
-- Migration 001: Add Time-Series Support
-- Community Health Intelligence
--
-- What this does:
--   1. Adds data_year to all three fact tables
--   2. Updates primary keys to be composite (county_fips + data_year)
--   3. Rebuilds indexes to include year for efficient filtering
--   4. Drops and recreates the county_scores table to include year
--   5. Adds a data_loads tracking table so we know what's been ingested
--   6. Adds trend analysis views at the bottom
--
-- Run this ONCE against your existing DB. It is safe on empty tables.
-- If you have existing data it will default to data_year = 2022.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Track what years have been loaded per source
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_loads (
    id              SERIAL PRIMARY KEY,
    source          VARCHAR(50)  NOT NULL,  -- 'cdc_places', 'census_acs', 'food_access'
    data_year       SMALLINT     NOT NULL,
    state_fips      CHAR(2),               -- NULL means national load
    record_count    INTEGER,
    loaded_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    notes           TEXT,
    UNIQUE (source, data_year, state_fips)
);

-- ---------------------------------------------------------------------------
-- CDC Health Data — add data_year
-- ---------------------------------------------------------------------------
ALTER TABLE cdc_health_data
    ADD COLUMN IF NOT EXISTS data_year SMALLINT NOT NULL DEFAULT 2022;

-- Update existing rows to 2022 if you have them
UPDATE cdc_health_data SET data_year = 2022 WHERE data_year = 0;

-- Drop old PK, make composite
ALTER TABLE cdc_health_data DROP CONSTRAINT IF EXISTS cdc_health_data_pkey;
ALTER TABLE cdc_health_data ADD PRIMARY KEY (county_fips, data_year);

DROP INDEX IF EXISTS idx_cdc_state;
DROP INDEX IF EXISTS idx_cdc_fips;
CREATE INDEX idx_cdc_fips_year   ON cdc_health_data (county_fips, data_year);
CREATE INDEX idx_cdc_state_year  ON cdc_health_data (state_fips, data_year);

-- ---------------------------------------------------------------------------
-- Census ACS Data — add data_year
-- ---------------------------------------------------------------------------
ALTER TABLE census_acs_data
    ADD COLUMN IF NOT EXISTS data_year SMALLINT NOT NULL DEFAULT 2022;

UPDATE census_acs_data SET data_year = 2022 WHERE data_year = 0;

ALTER TABLE census_acs_data DROP CONSTRAINT IF EXISTS census_acs_data_pkey;
ALTER TABLE census_acs_data ADD PRIMARY KEY (county_fips, data_year);

DROP INDEX IF EXISTS idx_census_state;
DROP INDEX IF EXISTS idx_census_fips;
CREATE INDEX idx_census_fips_year  ON census_acs_data (county_fips, data_year);
CREATE INDEX idx_census_state_year ON census_acs_data (state_fips, data_year);

-- ---------------------------------------------------------------------------
-- Food Access Data — add data_year
-- ---------------------------------------------------------------------------
ALTER TABLE food_access_data
    ADD COLUMN IF NOT EXISTS data_year SMALLINT NOT NULL DEFAULT 2019;
-- NOTE: USDA Food Access Atlas updates less frequently than CDC/Census.
-- 2019 is the most recent full release as of this migration. Update as new
-- releases come out. Use the latest available year when loading.

UPDATE food_access_data SET data_year = 2019 WHERE data_year = 0;

ALTER TABLE food_access_data DROP CONSTRAINT IF EXISTS food_access_data_pkey;
ALTER TABLE food_access_data ADD PRIMARY KEY (county_fips, data_year);

DROP INDEX IF EXISTS idx_food_state;
DROP INDEX IF EXISTS idx_food_fips;
CREATE INDEX idx_food_fips_year  ON food_access_data (county_fips, data_year);
CREATE INDEX idx_food_state_year ON food_access_data (state_fips, data_year);

-- ---------------------------------------------------------------------------
-- County Risk Scores — rebuild to include year
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS county_scores CASCADE;

CREATE TABLE county_scores (
    county_fips          CHAR(5)       NOT NULL,
    data_year            SMALLINT      NOT NULL,

    -- Component scores (0-100 scale, higher = more risk)
    health_risk_score    NUMERIC(6,2),
    economic_risk_score  NUMERIC(6,2),
    food_access_burden   NUMERIC(6,2),
    preventive_care_gap  NUMERIC(6,2),

    -- Composite
    priority_score       NUMERIC(6,2)  NOT NULL,

    -- Rankings (populated by the scoring stored procedure)
    national_rank        INTEGER,
    state_rank           INTEGER,
    risk_tier            VARCHAR(10),   -- 'HIGH', 'ELEVATED', 'MODERATE', 'LOW'

    scored_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

    PRIMARY KEY (county_fips, data_year),
    FOREIGN KEY (county_fips) REFERENCES counties (county_fips)
);

CREATE INDEX idx_scores_year       ON county_scores (data_year);
CREATE INDEX idx_scores_priority   ON county_scores (data_year, priority_score DESC);
CREATE INDEX idx_scores_state_year ON county_scores (data_year)
    INCLUDE (county_fips, priority_score);

-- ---------------------------------------------------------------------------
-- Trend helper table — pre-computed year-over-year deltas
-- Refreshed by the scoring stored procedure after each annual load.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS county_score_trends (
    county_fips             CHAR(5)   NOT NULL,
    year_current            SMALLINT  NOT NULL,
    year_prior              SMALLINT  NOT NULL,

    priority_score_delta    NUMERIC(6,2),  -- positive = worsening
    health_delta            NUMERIC(6,2),
    economic_delta          NUMERIC(6,2),
    food_delta              NUMERIC(6,2),
    care_gap_delta          NUMERIC(6,2),

    trend_direction         VARCHAR(10)
        GENERATED ALWAYS AS (
            CASE
                WHEN priority_score_delta >  2 THEN 'WORSENING'
                WHEN priority_score_delta < -2 THEN 'IMPROVING'
                ELSE 'STABLE'
            END
        ) STORED,

    PRIMARY KEY (county_fips, year_current),
    FOREIGN KEY (county_fips) REFERENCES counties (county_fips)
);

CREATE INDEX idx_trends_direction ON county_score_trends (trend_direction, year_current);

-- =============================================================================
-- VIEWS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- v_latest_scores
-- Always returns the most recent scored year per county.
-- Use this for the default dashboard view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_latest_scores AS
WITH latest_year AS (
    SELECT MAX(data_year) AS yr FROM county_scores
)
SELECT
    cs.*,
    c.county_name,
    c.state_fips,
    c.state_abbr,
    c.state_name
FROM county_scores cs
JOIN counties c USING (county_fips)
CROSS JOIN latest_year
WHERE cs.data_year = latest_year.yr;

-- ---------------------------------------------------------------------------
-- v_score_history
-- All years for every county — used for the trend chart in the frontend.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_score_history AS
SELECT
    cs.county_fips,
    c.county_name,
    c.state_abbr,
    cs.data_year,
    cs.priority_score,
    cs.health_risk_score,
    cs.economic_risk_score,
    cs.food_access_burden,
    cs.preventive_care_gap,
    cs.risk_tier
FROM county_scores cs
JOIN counties c USING (county_fips)
ORDER BY cs.county_fips, cs.data_year;

-- ---------------------------------------------------------------------------
-- v_county_trends
-- Most-worsening and most-improving counties for the current → prior year.
-- Used by the "Counties to Watch" dashboard section.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_county_trends AS
SELECT
    t.county_fips,
    c.county_name,
    c.state_abbr,
    t.year_current,
    t.year_prior,
    t.priority_score_delta,
    t.trend_direction,
    s_curr.priority_score   AS current_score,
    s_curr.risk_tier        AS current_tier
FROM county_score_trends t
JOIN counties c             USING (county_fips)
JOIN county_scores s_curr   ON s_curr.county_fips = t.county_fips
                           AND s_curr.data_year    = t.year_current
WHERE t.year_current = (SELECT MAX(year_current) FROM county_score_trends)
ORDER BY ABS(t.priority_score_delta) DESC;

-- ---------------------------------------------------------------------------
-- v_state_risk_summary
-- Aggregated state-level stats per year — used by the state filter in UI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_state_risk_summary AS
SELECT
    c.state_fips,
    c.state_abbr,
    c.state_name,
    cs.data_year,
    COUNT(*)                            AS county_count,
    ROUND(AVG(cs.priority_score), 2)    AS avg_priority_score,
    ROUND(AVG(cs.health_risk_score), 2) AS avg_health_score,
    ROUND(AVG(cs.economic_risk_score), 2) AS avg_economic_score,
    ROUND(AVG(cs.food_access_burden), 2) AS avg_food_burden,
    COUNT(*) FILTER (WHERE cs.risk_tier = 'HIGH')     AS high_risk_counties,
    COUNT(*) FILTER (WHERE cs.risk_tier = 'ELEVATED') AS elevated_risk_counties
FROM county_scores cs
JOIN counties c USING (county_fips)
GROUP BY c.state_fips, c.state_abbr, c.state_name, cs.data_year;

-- =============================================================================
-- STORED PROCEDURE: compute_trends
-- Call after every annual data load to refresh county_score_trends.
-- =============================================================================
CREATE OR REPLACE PROCEDURE compute_trends(p_year_current SMALLINT)
LANGUAGE plpgsql AS $$
DECLARE
    v_year_prior SMALLINT;
BEGIN
    -- Find the year immediately before the one we just loaded
    SELECT MAX(data_year)
      INTO v_year_prior
      FROM county_scores
     WHERE data_year < p_year_current;

    IF v_year_prior IS NULL THEN
        RAISE NOTICE 'No prior year found; trend computation skipped.';
        RETURN;
    END IF;

    RAISE NOTICE 'Computing trends: % vs %', p_year_current, v_year_prior;

    DELETE FROM county_score_trends WHERE year_current = p_year_current;

    INSERT INTO county_score_trends (
        county_fips,
        year_current,
        year_prior,
        priority_score_delta,
        health_delta,
        economic_delta,
        food_delta,
        care_gap_delta
    )
    SELECT
        curr.county_fips,
        p_year_current,
        v_year_prior,
        ROUND(curr.priority_score    - prior.priority_score,    2),
        ROUND(curr.health_risk_score - prior.health_risk_score, 2),
        ROUND(curr.economic_risk_score - prior.economic_risk_score, 2),
        ROUND(curr.food_access_burden  - prior.food_access_burden,  2),
        ROUND(curr.preventive_care_gap - prior.preventive_care_gap, 2)
    FROM county_scores curr
    JOIN county_scores prior ON prior.county_fips = curr.county_fips
                            AND prior.data_year   = v_year_prior
    WHERE curr.data_year = p_year_current;

    GET DIAGNOSTICS v_year_prior = ROW_COUNT;  -- reuse variable
    RAISE NOTICE 'Trend rows inserted: %', v_year_prior;
END;
$$;

COMMIT;

-- =============================================================================
-- After running this migration, load new year data via ETL then call:
--   CALL compute_trends(2023);
--   CALL compute_trends(2024);
-- =============================================================================
