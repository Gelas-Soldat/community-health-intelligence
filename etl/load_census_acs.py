"""
load_census_acs.py — Census Bureau ACS 5-Year Estimates Loader
Updated for time-series schema (data_year column)

Uses the Census Bureau Data API (no key required for most calls,
but registering for a free key removes rate limits).
API docs: https://www.census.gov/data/developers/data-sets/acs-5year.html

Get a free API key: https://api.census.gov/data/key_signup.html
Set CENSUS_API_KEY in your .env file.
"""

import logging
import os
import time

import pandas as pd
import psycopg2
import psycopg2.extras
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

log = logging.getLogger(__name__)

CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", "")  # optional but recommended
CENSUS_BASE    = "https://api.census.gov/data"

# ---------------------------------------------------------------------------
# ACS variables we want → DB column names
# Full variable list: https://api.census.gov/data/{year}/acs/acs5/variables.json
# ---------------------------------------------------------------------------
ACS_VARIABLES: dict[str, str] = {
    "B01003_001E": "total_population",
    "B17001_002E": "poverty_population",    # people below poverty line
    "B17001_001E": "poverty_universe",      # total for poverty calc
    "B19013_001E": "median_household_income",
    "B27001_001E": "insurance_universe",    # total for insurance calc
    "B27001_005E": "uninsured_male_under6",
    "B27001_008E": "uninsured_male_6to17",
    "B27001_011E": "uninsured_male_18to24",
    "B27001_014E": "uninsured_male_25to34",
    "B27001_017E": "uninsured_male_35to44",
    "B27001_020E": "uninsured_male_45to54",
    "B27001_023E": "uninsured_male_55to64",
    "B27001_026E": "uninsured_male_65to74",
    "B27001_029E": "uninsured_male_75up",
    # Female uninsured (same age brackets)
    "B27001_033E": "uninsured_female_under6",
    "B27001_036E": "uninsured_female_6to17",
    "B27001_039E": "uninsured_female_18to24",
    "B27001_042E": "uninsured_female_25to34",
    "B27001_045E": "uninsured_female_35to44",
    "B27001_048E": "uninsured_female_45to54",
    "B27001_051E": "uninsured_female_55to64",
    "B27001_054E": "uninsured_female_65to74",
    "B27001_057E": "uninsured_female_75up",
    # Education
    "B15003_001E": "edu_universe",
    "B15003_017E": "edu_hs_diploma",
    "B15003_022E": "edu_bachelors",
    # Housing
    "B25002_002E": "housing_occupied",
    "B25002_001E": "housing_total",
    "B25003_002E": "housing_owner_occupied",
    # Race/ethnicity for disparity analysis (optional, used carefully)
    "B02001_002E": "pop_white_alone",
    "B02001_003E": "pop_black_alone",
    "B03001_003E": "pop_hispanic",
}

UNINSURED_COLS = [
    "uninsured_male_under6", "uninsured_male_6to17", "uninsured_male_18to24",
    "uninsured_male_25to34", "uninsured_male_35to44", "uninsured_male_45to54",
    "uninsured_male_55to64", "uninsured_male_65to74", "uninsured_male_75up",
    "uninsured_female_under6", "uninsured_female_6to17", "uninsured_female_18to24",
    "uninsured_female_25to34", "uninsured_female_35to44", "uninsured_female_45to54",
    "uninsured_female_55to64", "uninsured_female_65to74", "uninsured_female_75up",
]


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=15))
def _fetch_acs(year: int, variables: list[str], state_fips: str) -> list[dict]:
    """
    Hit the Census ACS5 API for one state, return raw rows as list of dicts.
    The API caps at 50 variables per request — we chunk if needed.
    """
    base_url = f"{CENSUS_BASE}/{year}/acs/acs5"
    params = {
        "get":   ",".join(["NAME"] + variables),
        "for":   "county:*",
        "in":    f"state:{state_fips}",
    }
    if CENSUS_API_KEY:
        params["key"] = CENSUS_API_KEY

    resp = requests.get(base_url, params=params, timeout=60)

    if resp.status_code == 404:
        # ACS5 may not have county data for every variable in every year —
        # fall back gracefully
        log.warning(f"    Census API 404 for state {state_fips} year {year} — skipping")
        return []

    resp.raise_for_status()
    rows = resp.json()
    headers = rows[0]
    return [dict(zip(headers, row)) for row in rows[1:]]


def _chunk_variables(variables: list[str], size: int = 45) -> list[list[str]]:
    """Split variable list into chunks to stay under the API's 50-var limit."""
    return [variables[i:i + size] for i in range(0, len(variables), size)]


def load_census_acs(conn, state_fips: str, state_abbr: str, year: int) -> int:
    """
    Load ACS 5-year estimates for one state.
    Makes multiple API calls if the variable list exceeds 45.
    Returns the number of rows upserted.
    """
    var_codes = list(ACS_VARIABLES.keys())
    chunks = _chunk_variables(var_codes)

    # Fetch all chunks and merge on county FIPS
    merged: dict[str, dict] = {}  # geoid → row dict

    for chunk in chunks:
        rows = _fetch_acs(year, chunk, state_fips)
        for row in rows:
            geoid = f"{row['state']}{row['county']}"
            if geoid not in merged:
                merged[geoid] = {"county_fips": geoid, "state_fips": state_fips}
            # Map API variable names → DB column names
            for api_col, db_col in ACS_VARIABLES.items():
                if api_col in row:
                    merged[geoid][db_col] = row[api_col]

    if not merged:
        log.warning(f"  Census {state_abbr} {year}: no rows returned")
        return 0

    df = pd.DataFrame(list(merged.values()))

    # Numeric coercion
    numeric_cols = [c for c in df.columns if c not in ("county_fips", "state_fips")]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Derived columns — compute before loading to keep DB lean
    df["poverty_rate_pct"] = (
        (df["poverty_population"] / df["poverty_universe"]) * 100
    ).round(2)

    df["uninsured_count"] = df[[c for c in UNINSURED_COLS if c in df.columns]].sum(axis=1)
    df["uninsured_rate_pct"] = (
        (df["uninsured_count"] / df["insurance_universe"]) * 100
    ).round(2)

    df["hs_grad_rate_pct"] = (
        (df["edu_hs_diploma"] / df["edu_universe"]) * 100
    ).round(2)

    df["homeownership_rate_pct"] = (
        (df["housing_owner_occupied"] / df["housing_occupied"]) * 100
    ).round(2)

    # Drop the raw uninsured bracket columns — we only store the rate
    cols_to_drop = UNINSURED_COLS + [
        "poverty_population", "poverty_universe",
        "insurance_universe", "uninsured_count",
        "edu_hs_diploma", "edu_universe",
        "housing_owner_occupied", "housing_occupied",
    ]
    df = df.drop(columns=[c for c in cols_to_drop if c in df.columns])

    df["data_year"] = year
    df["county_fips"] = df["county_fips"].str.zfill(5)

    cols = df.columns.tolist()
    placeholders = ", ".join(["%s"] * len(cols))
    col_names    = ", ".join(cols)
    updates      = ", ".join(
        f"{c} = EXCLUDED.{c}"
        for c in cols
        if c not in ("county_fips", "data_year")
    )

    sql = f"""
        INSERT INTO census_acs_data ({col_names})
        VALUES ({placeholders})
        ON CONFLICT (county_fips, data_year) DO UPDATE SET {updates}
    """
    records = [tuple(row) for row in df.itertuples(index=False, name=None)]

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, records, page_size=500)
    conn.commit()

    log.debug(f"  Census {state_abbr} {year}: {len(records):,} counties")
    return len(records)
