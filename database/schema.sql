-- Community Health Access BI Dashboard
-- PostgreSQL schema

DROP TABLE IF EXISTS analytics_county_scores CASCADE;
DROP TABLE IF EXISTS fact_food_access CASCADE;
DROP TABLE IF EXISTS fact_census_profile CASCADE;
DROP TABLE IF EXISTS fact_health_measures CASCADE;
DROP TABLE IF EXISTS dim_health_measure CASCADE;
DROP TABLE IF EXISTS dim_county CASCADE;

CREATE TABLE dim_county (
    county_fips TEXT PRIMARY KEY,
    county_name TEXT NOT NULL,
    state_fips TEXT NOT NULL,
    state_name TEXT NOT NULL,
    state_abbr TEXT,
    region TEXT
);

CREATE TABLE dim_health_measure (
    measure_id TEXT PRIMARY KEY,
    measure_name TEXT NOT NULL,
    category TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('higher_is_worse', 'higher_is_better')),
    business_definition TEXT
);

CREATE TABLE fact_health_measures (
    health_measure_key BIGSERIAL PRIMARY KEY,
    county_fips TEXT NOT NULL REFERENCES dim_county(county_fips),
    measure_id TEXT NOT NULL REFERENCES dim_health_measure(measure_id),
    year INTEGER NOT NULL,
    value NUMERIC(10,4),
    low_confidence NUMERIC(10,4),
    high_confidence NUMERIC(10,4),
    data_source TEXT DEFAULT 'CDC PLACES',
    loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (county_fips, measure_id, year)
);

CREATE TABLE fact_census_profile (
    census_profile_key BIGSERIAL PRIMARY KEY,
    county_fips TEXT NOT NULL REFERENCES dim_county(county_fips),
    year INTEGER NOT NULL,
    population INTEGER,
    median_household_income NUMERIC(12,2),
    poverty_rate NUMERIC(10,4),
    uninsured_rate NUMERIC(10,4),
    snap_household_rate NUMERIC(10,4),
    no_vehicle_household_rate NUMERIC(10,4),
    data_source TEXT DEFAULT 'Census ACS 5-Year',
    loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (county_fips, year)
);

CREATE TABLE fact_food_access (
    tract_fips TEXT PRIMARY KEY,
    county_fips TEXT NOT NULL REFERENCES dim_county(county_fips),
    year INTEGER NOT NULL,
    tract_population INTEGER,
    low_income_flag INTEGER,
    low_access_flag INTEGER,
    low_income_low_access_population NUMERIC(12,2),
    low_access_population NUMERIC(12,2),
    data_source TEXT DEFAULT 'USDA Food Access Research Atlas',
    loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE analytics_county_scores (
    county_fips TEXT NOT NULL REFERENCES dim_county(county_fips),
    year INTEGER NOT NULL,
    health_risk_score NUMERIC(10,4),
    economic_risk_score NUMERIC(10,4),
    food_access_score NUMERIC(10,4),
    priority_score NUMERIC(10,4),
    state_priority_rank INTEGER,
    national_priority_rank INTEGER,
    risk_tier TEXT,
    refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (county_fips, year)
);
