"""
load_census_acs.py — Census ACS 5-Year Loader
Matches actual schema: dim_county, fact_census_profile

Fetches from Census Bureau API per state.
Free API key: https://api.census.gov/data/key_signup.html
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

from dotenv import load_dotenv
load_dotenv()
CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", "")
CENSUS_BASE    = "https://api.census.gov/data"

# ACS variables → what we store
# Kept to columns that exist in fact_census_profile:
#   population, median_household_income, poverty_rate,
#   uninsured_rate, snap_household_rate, no_vehicle_household_rate
ACS_VARIABLES = {
    "B01003_001E": "population",
    "B19013_001E": "median_household_income",
    "B17001_002E": "poverty_count",
    "B17001_001E": "poverty_universe",
    "B27001_001E": "insurance_universe",
    # Uninsured totals (male + female) — we sum these
    "B27001_005E": "unins_m_u6",
    "B27001_008E": "unins_m_6_17",
    "B27001_011E": "unins_m_18_24",
    "B27001_014E": "unins_m_25_34",
    "B27001_017E": "unins_m_35_44",
    "B27001_020E": "unins_m_45_54",
    "B27001_023E": "unins_m_55_64",
    "B27001_026E": "unins_m_65_74",
    "B27001_029E": "unins_m_75up",
    "B27001_033E": "unins_f_u6",
    "B27001_036E": "unins_f_6_17",
    "B27001_039E": "unins_f_18_24",
    "B27001_042E": "unins_f_25_34",
    "B27001_045E": "unins_f_35_44",
    "B27001_048E": "unins_f_45_54",
    "B27001_051E": "unins_f_55_64",
    "B27001_054E": "unins_f_65_74",
    "B27001_057E": "unins_f_75up",
    # SNAP
    "B22010_002E": "snap_households",
    "B22010_001E": "snap_universe",
    # No vehicle
    "B08201_002E": "no_vehicle_households",
    "B08201_001E": "vehicle_universe",
}

UNINS_COLS = [v for k, v in ACS_VARIABLES.items() if v.startswith("unins_")]


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=15))
def _fetch(year, variables, state_fips):
    url = f"{CENSUS_BASE}/{year}/acs/acs5"
    params = {"get": ",".join(["NAME"] + variables), "for": "county:*", "in": f"state:{state_fips}"}
    if CENSUS_API_KEY:
        params["key"] = CENSUS_API_KEY
    resp = requests.get(url, params=params, timeout=60)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    rows = resp.json()
    headers = rows[0]
    return [dict(zip(headers, r)) for r in rows[1:]]


def load_census_acs(conn, state_fips, state_abbr, year):
    var_codes = list(ACS_VARIABLES.keys())
    # Chunk into groups of 45 to stay under Census API limit
    chunks = [var_codes[i:i+45] for i in range(0, len(var_codes), 45)]

    merged = {}
    for chunk in chunks:
        rows = _fetch(year, chunk, state_fips)
        for row in rows:
            geoid = f"{row['state']}{row['county']}"
            if geoid not in merged:
                merged[geoid] = {"county_fips": geoid, "state_fips": state_fips}
            for api_col, db_col in ACS_VARIABLES.items():
                if api_col in row:
                    merged[geoid][db_col] = row[api_col]

    if not merged:
        log.warning(f"  Census {state_abbr} {year}: no data returned")
        return 0

    df = pd.DataFrame(list(merged.values()))

    # Coerce to numeric
    for col in df.columns:
        if col not in ("county_fips", "state_fips"):
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Derived rates — match fact_census_profile columns exactly
    df["poverty_rate"] = (df["poverty_count"] / df["poverty_universe"] * 100).round(4)

    unins_sum = df[[c for c in UNINS_COLS if c in df.columns]].sum(axis=1)
    df["uninsured_rate"] = (unins_sum / df["insurance_universe"] * 100).round(4)

    df["snap_household_rate"] = (df["snap_households"] / df["snap_universe"] * 100).round(4)
    df["no_vehicle_household_rate"] = (df["no_vehicle_households"] / df["vehicle_universe"] * 100).round(4)

    # Keep only columns that exist in fact_census_profile
    keep = ["county_fips", "population", "median_household_income",
            "poverty_rate", "uninsured_rate", "snap_household_rate",
            "no_vehicle_household_rate"]
    df = df[[c for c in keep if c in df.columns]].copy()
    df["year"] = year
    df["county_fips"] = df["county_fips"].astype(str).str.zfill(5)
    df = df.dropna(subset=["county_fips"])

    records = [tuple(r) for r in df.itertuples(index=False, name=None)]
    cols = df.columns.tolist()
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ("county_fips", "year"))

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, f"""
            INSERT INTO fact_census_profile ({", ".join(cols)})
            VALUES ({", ".join(["%s"] * len(cols))})
            ON CONFLICT (county_fips, year) DO UPDATE SET {updates}
        """, records, page_size=500)
    conn.commit()

    log.debug(f"  Census {state_abbr} {year}: {len(records):,} rows")
    return len(records)
