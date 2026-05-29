"""
load_food_access.py — USDA Food Access Research Atlas Loader
Matches actual schema: fact_food_access (tract-level)

File: data/raw/food_access_atlas_2019.xlsx
Sheet: Food Access Research Atlas
"""

import logging
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)

ATLAS_FILES = {
    2019: ("data/raw/food_access_atlas_2019.xlsx", "Food Access Research Atlas"),
}

ATLAS_YEAR_MAP = {
    2019: 2019, 2020: 2019, 2021: 2019,
    2022: 2019, 2023: 2019, 2024: 2019,
}


def _upsert_missing_counties(cur, df):
    county_df = df[["county_fips", "County", "State"]].drop_duplicates("county_fips").copy()
    county_df["state_fips"] = county_df["county_fips"].str[:2]
    records = [
        (row.county_fips, row.County, row.state_fips, row.State, row.State)
        for row in county_df.itertuples()
        if row.county_fips and len(str(row.county_fips)) == 5
    ]
    psycopg2.extras.execute_batch(cur, """
        INSERT INTO dim_county
            (county_fips, county_name, state_fips, state_name, state_abbr)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (county_fips) DO NOTHING
    """, records, page_size=500)
    log.info(f"  dim_county: ensured {len(records):,} counties exist")


def load_food_access(conn, atlas_year, data_year):
    if atlas_year not in ATLAS_FILES:
        raise ValueError(f"No atlas file configured for year {atlas_year}.")

    file_path, sheet_name = ATLAS_FILES[atlas_year]

    if not Path(file_path).exists():
        raise FileNotFoundError(
            f"Atlas file not found: {file_path}\n"
            f"Download from: https://www.ers.usda.gov/data-products/"
            f"food-access-research-atlas/download-the-data/"
        )

    log.info(f"  Reading atlas: {file_path} / sheet: {sheet_name}")
    df = pd.read_excel(file_path, sheet_name=sheet_name, dtype=str)
    log.info(f"  Raw rows: {len(df):,} tracts")

    # Build FIPS columns
    df["tract_fips"]  = df["CensusTract"].astype(str).str.zfill(11)
    df["county_fips"] = df["tract_fips"].str[:5]

    # Filter to valid FIPS
    df = df[df["tract_fips"].str.match(r"^\d{11}$")]
    df = df[df["county_fips"].str.match(r"^\d{5}$")]
    df = df.dropna(subset=["tract_fips", "county_fips"])

    # Coerce numeric columns — errors="coerce" turns bad values into NaN
    df["tract_population"]                = pd.to_numeric(df["Pop2010"],        errors="coerce")
    df["low_income_flag"]                 = pd.to_numeric(df["LowIncomeTracts"],errors="coerce")
    df["low_access_flag"]                 = pd.to_numeric(df["LATracts1"],      errors="coerce")
    df["low_income_low_access_population"]= pd.to_numeric(df["lalowi1"],        errors="coerce")
    df["low_access_population"]           = pd.to_numeric(df["lapop1"],         errors="coerce")

    # Replace NaN with None so Postgres stores NULL instead of NaN
    # NaN stored as numeric NaN poisons any SUM/AVG that touches it
    numeric_cols = [
        "tract_population", "low_income_flag", "low_access_flag",
        "low_income_low_access_population", "low_access_population",
    ]
    for col in numeric_cols:
        df[col] = df[col].where(df[col].notna(), other=None)

    df["year"] = data_year

    log.info(f"  After filter: {len(df):,} tracts, "
             f"{df['county_fips'].nunique():,} counties")

    keep = [
        "tract_fips", "county_fips", "year",
        "tract_population", "low_income_flag", "low_access_flag",
        "low_income_low_access_population", "low_access_population"
    ]
    df = df[keep].copy()

    cols    = df.columns.tolist()
    ph      = ", ".join(["%s"] * len(cols))
    names   = ", ".join(cols)
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "tract_fips")
    records = [tuple(r) for r in df.itertuples(index=False, name=None)]

    with conn.cursor() as cur:
        _upsert_missing_counties(cur, df)
        psycopg2.extras.execute_batch(cur, f"""
            INSERT INTO fact_food_access ({names})
            VALUES ({ph})
            ON CONFLICT (tract_fips) DO UPDATE SET {updates}
        """, records, page_size=1000)

    conn.commit()
    log.info(f"  Food Access atlas {atlas_year}: {len(records):,} tracts upserted")
    return len(records)