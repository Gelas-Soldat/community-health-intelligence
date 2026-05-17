-- Indexes for dashboard and analytical query performance

CREATE INDEX IF NOT EXISTS idx_health_county_year ON fact_health_measures(county_fips, year);
CREATE INDEX IF NOT EXISTS idx_health_measure_year ON fact_health_measures(measure_id, year);
CREATE INDEX IF NOT EXISTS idx_census_county_year ON fact_census_profile(county_fips, year);
CREATE INDEX IF NOT EXISTS idx_food_county_year ON fact_food_access(county_fips, year);
CREATE INDEX IF NOT EXISTS idx_scores_year_priority ON analytics_county_scores(year, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_county_state ON dim_county(state_name, county_name);
