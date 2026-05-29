"""
load_food_access.py — USDA ERS Food Access Research Atlas Loader
Updated for time-series schema (data_year column)

USDA releases new atlas data infrequently (~every 3-5 years).
We store the atlas_year the data actually reflects, plus the
pipeline's data_year for consistency with the other tables.

Atlas download page:
https://www.ers.usda.gov/data-products/food-access-research-atlas/download-the-data/

The 2019 atlas is the most current full release (as of 2026).
Download the CSV and place it at: data/raw/food_access_atlas_{year}.csv
"""

import logging
import os
from pathlib import Path

import pandas as pd
import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Atlas file locations — update path when a new atlas is released
# ---------------------------------------------------------------------------
ATLAS_FILE_MAP: dict[int, str] = {
    2015: "data/raw/food_access_atlas_2015.csv",
    2019: "data/raw/food_access_atlas_2019.csv",
    # 2024: "data/raw/food_access_atlas_2024.csv",  # add when released
}

# Columns from the USDA CSV → DB column names
COLUMN_MAP: dict[str, str] = {
    "CensusTract":       None,           # we aggregate up to county; skip
    "State":             "state_abbr",
    "County":            "county_name",
    "CensusTract":       None,
    # County-level food access flags (pre-aggregated in the atlas)
    "lapophalfshare":    "pct_low_access_half_mile",     # % pop > 0.5 mi from store
    "lapop1share":       "pct_low_access_1_mile",        # % pop > 1 mi from store
    "lapop10share":      "pct_low_access_10_miles",      # % pop > 10 mi (rural)
    "lapop20share":      "pct_low_access_20_miles",
    "lalowihalf":        "low_income_low_access_half",   # LI + low access 0.5mi
    "lalowi1":           "low_income_low_access_1",      # LI + low access 1mi
    "lalowi10":          "low_income_low_access_10",
    "lalowi20":          "low_income_low_access_20",
    "TractSNAP":         "snap_households",
    "TractHUNV":         "households_no_vehicle",
    "TractSupermarket":  "supermarket_count",
    "TractGrocGrocery":  "grocery_store_count",
    "TractConvenience":  "convenience_store_count",
    "TractFastFood":     "fast_food_count",
    # Computed by us
    # food_desert_flag  — county is flagged if lalowi1 > 33% of county population
}

# The 2019 atlas uses a county FIPS field directly
COUNTY_FIPS_COLS = ["FIPS", "CensusTract"]   # try in order


def _find_fips_col(df: pd.DataFrame) -> str:
    for col in COUNTY_FIPS_COLS:
        if col in df.columns:
            return col
    raise ValueError(
        f"Could not find a county/tract FIPS column. "
        f"Available columns: {df.columns.tolist()[:20]}"
    )


def load_food_access(conn, atlas_year: int, data_year: int) -> int:
    """
    Load USDA Food Access atlas data.

    atlas_year: the actual release year of the atlas (e.g. 2019)
    data_year:  the pipeline year (used to key the row in the DB)

    The atlas file is at the census tract level; we aggregate to county
    using population-weighted means where needed.

    Returns number of counties upserted.
    """
    file_path = ATLAS_FILE_MAP.get(atlas_year)
    if file_path is None:
        available = sorted(ATLAS_FILE_MAP.keys())
        raise ValueError(
            f"No Food Access atlas file configured for {atlas_year}. "
            f"Available atlas years: {available}. "
            f"Download the file from USDA ERS and add the path to ATLAS_FILE_MAP."
        )

    if not Path(file_path).exists():
        raise FileNotFoundError(
            f"Atlas file not found: {file_path}\n"
            f"Download from: https://www.ers.usda.gov/data-products/"
            f"food-access-research-atlas/download-the-data/"
        )

    log.info(f"  Reading atlas file: {file_path}")
    df = pd.read_csv(file_path, dtype=str, encoding="latin-1")

    fips_col = _find_fips_col(df)
    log.info(f"  Using FIPS column: {fips_col} — {len(df):,} tract rows")

    # Extract county FIPS from tract FIPS (first 5 digits)
    df["county_fips"] = df[fips_col].astype(str).str.zfill(11).str[:5]

    # Rename known columns
    df = df.rename(columns={k: v for k, v in COLUMN_MAP.items() if v is not None})

    # Numeric coercion
    numeric_cols = [v for v in COLUMN_MAP.values()
                    if v is not None and v != "state_abbr" and v != "county_name"]
    existing_numeric = [c for c in numeric_cols if c in df.columns]
    for col in existing_numeric:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Aggregate tract rows → county rows
    # For share/percentage columns use mean; for count columns use sum
    share_cols = [c for c in existing_numeric if c.startswith("pct_")]
    count_cols = [c for c in existing_numeric if not c.startswith("pct_")]

    agg_dict = {c: "mean" for c in share_cols}
    agg_dict.update({c: "sum" for c in count_cols})

    # Keep state_abbr as mode (all tracts in a county share same state)
    if "state_abbr" in df.columns:
        agg_dict["state_abbr"] = lambda x: x.mode().iloc[0] if len(x) > 0 else None

    county_df = df.groupby("county_fips").agg(agg_dict).reset_index()

    # Round share columns
    for col in share_cols:
        if col in county_df.columns:
            county_df[col] = county_df[col].round(2)

    # Food desert flag: county is flagged if >33% of pop is low income + low access
    if "pct_low_access_1_mile" in county_df.columns:
        county_df["food_desert_flag"] = (
            county_df["pct_low_access_1_mile"] > 33.0
        ).astype(int)

    county_df["data_year"]  = data_year
    county_df["atlas_year"] = atlas_year
    county_df["county_fips"] = county_df["county_fips"].str.zfill(5)

    # Filter to valid 5-digit FIPS (drop non-county rows that might sneak in)
    county_df = county_df[county_df["county_fips"].str.match(r"^\d{5}$")]
    county_df = county_df.dropna(subset=["county_fips"])

    cols = county_df.columns.tolist()
    placeholders = ", ".join(["%s"] * len(cols))
    col_names    = ", ".join(cols)
    updates      = ", ".join(
        f"{c} = EXCLUDED.{c}"
        for c in cols
        if c not in ("county_fips", "data_year")
    )

    sql = f"""
        INSERT INTO food_access_data ({col_names})
        VALUES ({placeholders})
        ON CONFLICT (county_fips, data_year) DO UPDATE SET {updates}
    """
    records = [tuple(row) for row in county_df.itertuples(index=False, name=None)]

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, records, page_size=500)
    conn.commit()

    log.info(f"  Food Access atlas {atlas_year}: {len(records):,} counties upserted")
    return len(records)
