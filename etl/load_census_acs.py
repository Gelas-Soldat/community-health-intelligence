"""Load selected Census ACS 5 year county profile variables.

Uses the public Census API. Add a Census API key if you have one, but many calls work without it.
"""

import os
import requests
import pandas as pd
from sqlalchemy import create_engine, text

BASE_URL = "https://api.census.gov/data/2024/acs/acs5/profile"
VARIABLES = {
    "NAME": "name",
    "DP05_0001E": "population",
    "DP03_0062E": "median_household_income",
    "DP03_0128PE": "poverty_rate",
    "DP03_0099PE": "uninsured_rate",
    "DP03_0074PE": "snap_household_rate",
    "DP04_0058PE": "no_vehicle_household_rate",
}


def main() -> None:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is required")

    params = {
        "get": ",".join(VARIABLES.keys()),
        "for": "county:*",
        "in": "state:*",
    }
    api_key = os.getenv("CENSUS_API_KEY")
    if api_key:
        params["key"] = api_key

    response = requests.get(BASE_URL, params=params, timeout=60)
    response.raise_for_status()
    rows = response.json()
    df = pd.DataFrame(rows[1:], columns=rows[0])
    df = df.rename(columns=VARIABLES)
    df["county_fips"] = df["state"] + df["county"]
    df["year"] = 2024

    numeric_cols = [
        "population",
        "median_household_income",
        "poverty_rate",
        "uninsured_rate",
        "snap_household_rate",
        "no_vehicle_household_rate",
    ]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    county_parts = df["name"].str.extract(r"^(?P<county_name>.*), (?P<state_name>.*)$")
    df["county_name"] = county_parts["county_name"].str.replace(" County", "", regex=False)
    df["state_name"] = county_parts["state_name"]
    df["state_fips"] = df["state"]

    counties = df[["county_fips", "county_name", "state_fips", "state_name"]].drop_duplicates()
    profile = df[["county_fips", "year"] + numeric_cols]

    engine = create_engine(db_url)
    with engine.begin() as conn:
        counties.to_sql("stg_counties", conn, if_exists="replace", index=False)
        profile.to_sql("stg_census_profile", conn, if_exists="replace", index=False)
        conn.execute(text("""
            INSERT INTO dim_county (county_fips, county_name, state_fips, state_name)
            SELECT county_fips, county_name, state_fips, state_name
            FROM stg_counties
            ON CONFLICT (county_fips) DO UPDATE SET
                county_name = EXCLUDED.county_name,
                state_fips = EXCLUDED.state_fips,
                state_name = EXCLUDED.state_name;
        """))
        conn.execute(text("""
            INSERT INTO fact_census_profile (
                county_fips, year, population, median_household_income, poverty_rate,
                uninsured_rate, snap_household_rate, no_vehicle_household_rate
            )
            SELECT county_fips, year, population, median_household_income, poverty_rate,
                   uninsured_rate, snap_household_rate, no_vehicle_household_rate
            FROM stg_census_profile
            ON CONFLICT (county_fips, year) DO UPDATE SET
                population = EXCLUDED.population,
                median_household_income = EXCLUDED.median_household_income,
                poverty_rate = EXCLUDED.poverty_rate,
                uninsured_rate = EXCLUDED.uninsured_rate,
                snap_household_rate = EXCLUDED.snap_household_rate,
                no_vehicle_household_rate = EXCLUDED.no_vehicle_household_rate,
                loaded_at = CURRENT_TIMESTAMP;
        """))

    print(f"Loaded {len(profile):,} Census ACS county profiles")


if __name__ == "__main__":
    main()
