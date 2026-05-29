"""
load_cdc_places.py — CDC PLACES County Health Data Loader
Matches actual schema: dim_county, dim_health_measure, fact_health_measures
"""

import io
import logging

import pandas as pd
import psycopg2
import psycopg2.extras
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

log = logging.getLogger(__name__)

CDC_PLACES_URLS = {
    2020: "https://data.cdc.gov/api/views/duw2-7jbt/rows.csv?accessType=DOWNLOAD",
    2021: "https://data.cdc.gov/api/views/swc5-untb/rows.csv?accessType=DOWNLOAD",
    2022: "https://data.cdc.gov/api/views/swc5-untb/rows.csv?accessType=DOWNLOAD",
    2023: "https://data.cdc.gov/api/views/swc5-untb/rows.csv?accessType=DOWNLOAD",
}

CRUDE_PREV_TYPE = "CrdPrv"

MEASURE_WHITELIST = {
    "DIABETES", "OBESITY", "BPHIGH", "CHD", "COPD", "CANCER",
    "CASTHMA", "STROKE", "MHLTH", "PHLTH",
    "CHECKUP", "DENTAL", "MAMMOUSE", "CERVICAL", "CHOLSCREEN",
    "CSMOKING", "LPA", "SLEEP",
}

MEASURE_DIRECTION = {
    "DIABETES":   "higher_is_worse",
    "OBESITY":    "higher_is_worse",
    "BPHIGH":     "higher_is_worse",
    "CHD":        "higher_is_worse",
    "COPD":       "higher_is_worse",
    "CANCER":     "higher_is_worse",
    "CASTHMA":    "higher_is_worse",
    "STROKE":     "higher_is_worse",
    "MHLTH":      "higher_is_worse",
    "PHLTH":      "higher_is_worse",
    "CHECKUP":    "higher_is_better",
    "DENTAL":     "higher_is_better",
    "MAMMOUSE":   "higher_is_better",
    "CERVICAL":   "higher_is_better",
    "CHOLSCREEN": "higher_is_better",
    "CSMOKING":   "higher_is_worse",
    "LPA":        "higher_is_worse",
    "SLEEP":      "higher_is_worse",
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=15))
def _download(url):
    log.info("  Downloading CDC PLACES CSV...")
    resp = requests.get(url, timeout=180)
    resp.raise_for_status()
    return pd.read_csv(io.StringIO(resp.text), dtype=str)


def load_cdc_places(conn, year):
    if year not in CDC_PLACES_URLS:
        raise ValueError(f"No URL configured for year {year}.")

    df = _download(CDC_PLACES_URLS[year])
    log.info(f"  Raw rows: {len(df):,} — filtering to county CrudePrev...")

    df = df[df["DataValueTypeID"] == CRUDE_PREV_TYPE].copy()
    df = df[df["MeasureId"].isin(MEASURE_WHITELIST)].copy()

    df["county_fips"] = df["LocationID"].astype(str).str.zfill(5)
    df = df[df["county_fips"].str.match(r"^\d{5}$")].copy()
    df = df.dropna(subset=["county_fips"])

    # Coerce numerics — drop rows where Data_Value is NaN or non-numeric
    df["Data_Value"]            = pd.to_numeric(df["Data_Value"],            errors="coerce")
    df["Low_Confidence_Limit"]  = pd.to_numeric(df["Low_Confidence_Limit"],  errors="coerce")
    df["High_Confidence_Limit"] = pd.to_numeric(df["High_Confidence_Limit"], errors="coerce")

    # Drop rows with no valid value — prevents NaN from entering Postgres
    df = df.dropna(subset=["Data_Value"])

    log.info(f"  After filter: {len(df):,} rows, "
             f"{df['county_fips'].nunique():,} counties, "
             f"{df['MeasureId'].nunique()} measures")

    with conn.cursor() as cur:

        # dim_county
        county_df = df[["county_fips", "LocationName", "StateAbbr", "StateDesc"]]\
                      .drop_duplicates("county_fips")
        county_records = [
            (row.county_fips, row.LocationName,
             row.county_fips[:2], row.StateDesc, row.StateAbbr)
            for row in county_df.itertuples()
        ]
        psycopg2.extras.execute_batch(cur, """
            INSERT INTO dim_county
                (county_fips, county_name, state_fips, state_name, state_abbr)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (county_fips) DO UPDATE SET
                county_name = EXCLUDED.county_name,
                state_name  = EXCLUDED.state_name,
                state_abbr  = EXCLUDED.state_abbr
        """, county_records, page_size=500)
        log.info(f"  dim_county: {len(county_records):,} rows upserted")

        # dim_health_measure
        measure_df = df[["MeasureId", "Measure", "Category"]].drop_duplicates("MeasureId")
        measure_records = [
            (row.MeasureId, row.Measure, row.Category,
             MEASURE_DIRECTION.get(row.MeasureId, "higher_is_worse"))
            for row in measure_df.itertuples()
        ]
        psycopg2.extras.execute_batch(cur, """
            INSERT INTO dim_health_measure
                (measure_id, measure_name, category, direction)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (measure_id) DO UPDATE SET
                measure_name = EXCLUDED.measure_name,
                category     = EXCLUDED.category,
                direction    = EXCLUDED.direction
        """, measure_records, page_size=100)
        log.info(f"  dim_health_measure: {len(measure_records)} measures upserted")

        # fact_health_measures
        fact_records = [
            (row.county_fips, row.MeasureId, year,
             row.Data_Value, row.Low_Confidence_Limit, row.High_Confidence_Limit)
            for row in df.itertuples()
        ]
        psycopg2.extras.execute_batch(cur, """
            INSERT INTO fact_health_measures
                (county_fips, measure_id, year, value,
                 low_confidence, high_confidence)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (county_fips, measure_id, year) DO UPDATE SET
                value           = EXCLUDED.value,
                low_confidence  = EXCLUDED.low_confidence,
                high_confidence = EXCLUDED.high_confidence
        """, fact_records, page_size=1000)

    conn.commit()
    log.info(f"  CDC PLACES {year}: {len(fact_records):,} fact rows upserted")
    return len(fact_records)
