"""Load CDC PLACES county health measures into PostgreSQL.

This script is intentionally portfolio friendly: readable, simple, and easy to discuss.
Set DATABASE_URL in your environment before running.
"""

import os
import pandas as pd
from sqlalchemy import create_engine, text

CDC_PLACES_CSV_URL = "https://data.cdc.gov/resource/swc5-untb.csv?$limit=50000"
TARGET_MEASURES = {
    "DIABETES": "Diabetes among adults",
    "OBESITY": "Obesity among adults",
    "CSMOKING": "Current smoking among adults",
    "BPHIGH": "High blood pressure among adults",
    "LPA": "No leisure-time physical activity among adults",
    "CHECKUP": "Routine checkup among adults",
}


def clean_fips(value: str) -> str:
    return str(value).zfill(5)


def main() -> None:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is required")

    engine = create_engine(db_url)
    df = pd.read_csv(CDC_PLACES_CSV_URL, dtype=str)

    expected = ["locationid", "measureid", "data_value", "low_confidence_limit", "high_confidence_limit"]
    missing = [col for col in expected if col not in df.columns]
    if missing:
        raise ValueError(f"Missing expected columns: {missing}")

    df = df[df["measureid"].isin(TARGET_MEASURES.keys())].copy()
    df["county_fips"] = df["locationid"].apply(clean_fips)
    df["value"] = pd.to_numeric(df["data_value"], errors="coerce")
    df["low_confidence"] = pd.to_numeric(df["low_confidence_limit"], errors="coerce")
    df["high_confidence"] = pd.to_numeric(df["high_confidence_limit"], errors="coerce")
    df["year"] = 2025

    measures = pd.DataFrame(
        [
            {
                "measure_id": key,
                "measure_name": name,
                "category": "Health Risk" if key != "CHECKUP" else "Preventive Care",
                "direction": "higher_is_worse" if key != "CHECKUP" else "higher_is_better",
                "business_definition": name,
            }
            for key, name in TARGET_MEASURES.items()
        ]
    )

    health = df[["county_fips", "measureid", "year", "value", "low_confidence", "high_confidence"]].rename(
        columns={"measureid": "measure_id"}
    )

    with engine.begin() as conn:
        measures.to_sql("stg_health_measures", conn, if_exists="replace", index=False)
        health.to_sql("stg_health_values", conn, if_exists="replace", index=False)
        conn.execute(text("""
            INSERT INTO dim_health_measure (measure_id, measure_name, category, direction, business_definition)
            SELECT measure_id, measure_name, category, direction, business_definition
            FROM stg_health_measures
            ON CONFLICT (measure_id) DO UPDATE SET
                measure_name = EXCLUDED.measure_name,
                category = EXCLUDED.category,
                direction = EXCLUDED.direction,
                business_definition = EXCLUDED.business_definition;
        """))
        conn.execute(text("""
            INSERT INTO fact_health_measures (county_fips, measure_id, year, value, low_confidence, high_confidence)
            SELECT county_fips, measure_id, year, value, low_confidence, high_confidence
            FROM stg_health_values
            WHERE value IS NOT NULL
            ON CONFLICT (county_fips, measure_id, year) DO UPDATE SET
                value = EXCLUDED.value,
                low_confidence = EXCLUDED.low_confidence,
                high_confidence = EXCLUDED.high_confidence,
                loaded_at = CURRENT_TIMESTAMP;
        """))

    print(f"Loaded {len(health):,} CDC PLACES records")


if __name__ == "__main__":
    main()
