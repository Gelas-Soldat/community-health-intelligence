-- Performance tuning examples

EXPLAIN ANALYZE
SELECT *
FROM vw_executive_county_priority
WHERE year = 2025
ORDER BY priority_score DESC
LIMIT 25;

-- Materialized view option for dashboard performance
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_county_priority_dashboard AS
SELECT * FROM vw_executive_county_priority;

CREATE INDEX IF NOT EXISTS idx_mv_priority_year_score
ON mv_county_priority_dashboard(year, priority_score DESC);

-- Run this after loading new data
REFRESH MATERIALIZED VIEW mv_county_priority_dashboard;
