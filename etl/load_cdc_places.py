"""
load_cdc_places.py — CDC PLACES County Health Data Loader
Updated for time-series schema (data_year column)

CDC PLACES releases one national CSV per year covering all ~3,000+ counties.
Source: https://data.cdc.gov/500-Cities-Places/PLACES-Local-Data-for-Better-Health-County-Data-20/swc5-untb/about_data

The download URL pattern changes with each release. Update CDC_PLACES_URLS
as new years become available.
"""

import io
import logging
import os

import pandas as pd
import psycopg2
import psycopg2.extras
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CDC PLACES Socrata API download URLs by year
# To get a new one: go to the dataset page, click Export → CSV → copy the URL
# ---------------------------------------------------------------------------
CDC_PLACES_URLS: dict[int, str] = {
    2020: "https://data.cdc.gov/api/views/duw2-7jbt/rows.csv?accessType=DOWNLOAD",
    2021: "https://data.cdc.gov/api/views/swc5-untb/rows.csv?accessType=DOWNLOAD",
    2022: "https://data.cdc.gov/api/views/swc5-untb/rows.csv?accessType=DOWNLOAD",
    2023: "https://data.cdc.gov/api/views/swc5-untb/rows.csv?accessType=DOWNLOAD",
    # Add new years here as CDC releases them
}

# Columns we care about — map CSV column name → DB column name
COLUMN_MAP: dict[str, str] = {
    "CountyFIPS":         "county_fips",
    "StateAbbr":          "state_abbr",
    "StateDesc":          "state_name",
    "CountyName":         "county_name",
    # Health outcomes
    "DIABETES_CrudePrev": "diabetes_pct",
    "OBESITY_CrudePrev":  "obesity_pct",
    "BPHIGH_CrudePrev":   "hypertension_pct",
    "CHD_CrudePrev":      "coronary_heart_disease_pct",
    "COPD_CrudePrev":     "copd_pct",
    "CANCER_CrudePrev":   "cancer_pct",
    "CASTHMA_CrudePrev":  "asthma_pct",
    "STROKE_CrudePrev":   "stroke_pct",
    "MHLTH_CrudePrev":    "mental_health_poor_pct",
    "PHLTH_CrudePrev":    "physical_health_poor_pct",
    # Preventive care
    "CHECKUP_CrudePrev":   "annual_checkup_pct",
    "DENTAL_CrudePrev":    "dental_visit_pct",
    "MAMMOUSE_CrudePrev":  "mammography_pct",
    "CERVICAL_CrudePrev":  "cervical_screening_pct",
    "CHOLSCREEN_CrudePrev":"cholesterol_screening_pct",
    # Behaviors
    "CSMOKING_CrudePrev":  "smoking_pct",
    "LPA_CrudePrev":       "no_leisure_activity_pct",
    "SLEEP_CrudePrev":     "sleep_insufficient_pct",
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _download_csv(url: str) -> pd.DataFrame:
    log.info(f"  Downloading CDC PLACES CSV...")
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    return pd.read_csv(io.StringIO(resp.text), dtype=str)


def load_cdc_places(conn, year: int) -> int:
    """
    Download and load CDC PLACES county data for the given year.
    Returns the number of rows inserted/updated.
    """
    if year not in CDC_PLACES_URLS:
        available = sorted(CDC_PLACES_URLS.keys())
        raise ValueError(
            f"No CDC PLACES URL configured for {year}. "
            f"Available years: {available}. "
            f"Add the download URL to CDC_PLACES_URLS in load_cdc_places.py."
        )

    df = _download_csv(CDC_PLACES_URLS[year])

    # Keep only county-level rows (PLACES also has census tract data)
    if "GeographicLevel" in df.columns:
        df = df[df["GeographicLevel"] == "County"].copy()

    # Rename columns to DB names
    df = df.rename(columns=COLUMN_MAP)
    db_cols = list(COLUMN_MAP.values())
    available_cols = [c for c in db_cols if c in df.columns]
    df = df[available_cols].copy()

    # Clean county_fips — ensure 5-char zero-padded string
    df["county_fips"] = df["county_fips"].astype(str).str.zfill(5)

    # Convert numeric columns
    numeric_cols = [c for c in available_cols
                    if c not in ("county_fips", "state_abbr", "state_name", "county_name")]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df["data_year"] = year
    df = df.dropna(subset=["county_fips"])

    # Build upsert SQL
    cols = df.columns.tolist()
    placeholders = ", ".join(["%s"] * len(cols))
    col_names    = ", ".join(cols)
    updates      = ", ".join(
        f"{c} = EXCLUDED.{c}"
        for c in cols
        if c not in ("county_fips", "data_year")
    )

    sql = f"""
        INSERT INTO cdc_health_data ({col_names})
        VALUES ({placeholders})
        ON CONFLICT (county_fips, data_year) DO UPDATE SET {updates}
    """

    records = [tuple(row) for row in df.itertuples(index=False, name=None)]

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, records, page_size=500)
    conn.commit()

    log.info(f"  CDC PLACES {year}: {len(records):,} counties upserted")
    return len(records)
