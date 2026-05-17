"""Load USDA Food Access Research Atlas workbook after manual download.

Download the spreadsheet from USDA ERS and place it in data/raw/food_access.xlsx.
Column names can change between releases, so this script includes basic validation.
"""

import os
from pathlib import Path
import pandas as pd
from sqlalchemy import create_engine, text

RAW_FILE = Path("data/raw/food_access.xlsx")


def main() -> None:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is required")
    if not RAW_FILE.exists():
        raise FileNotFoundError("Place USDA workbook at data/raw/food_access.xlsx")

    df = pd.read_excel(RAW_FILE)
    df.columns = [c.strip() for c in df.columns]

    column_map = {
        "CensusTract": "tract_fips",
        "County": "county_name",
        "State": "state_name",
        "POP2010": "tract_population",
        "LILATracts_1And10": "low_income_low_access_flag",
        "LowIncomeTracts": "low_income_flag",
        "LA1and10": "low_access_flag",
        "lapop1_10": "low_access_population",
        "lalowi1_10": "low_income_low_access_population",
    }
    available_map = {source: target for source, target in column_map.items() if source in df.columns}
    df = df.rename(columns=available_map)

    required = ["tract_fips", "tract_population", "low_income_low_access_population", "low_access_population"]
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise ValueError(f"Missing required USDA columns: {missing}")

    df["tract_fips"] = df["tract_fips"].astype(str).str.replace(".0", "", regex=False).str.zfill(11)
    df["county_fips"] = df["tract_fips"].str[:5]
    df["year"] = 2019

    keep_cols = [
        "tract_fips", "county_fips", "year", "tract_population", "low_income_flag",
        "low_access_flag", "low_income_low_access_population", "low_access_population"
    ]
    for col in keep_cols:
        if col not in df.columns:
            df[col] = None
    fact = df[keep_cols]

    engine = create_engine(db_url)
    with engine.begin() as conn:
        fact.to_sql("stg_food_access", conn, if_exists="replace", index=False)
        conn.execute(text("""
            INSERT INTO fact_food_access (
                tract_fips, county_fips, year, tract_population, low_income_flag,
                low_access_flag, low_income_low_access_population, low_access_population
            )
            SELECT tract_fips, county_fips, year, tract_population, low_income_flag,
                   low_access_flag, low_income_low_access_population, low_access_population
            FROM stg_food_access
            ON CONFLICT (tract_fips) DO UPDATE SET
                county_fips = EXCLUDED.county_fips,
                year = EXCLUDED.year,
                tract_population = EXCLUDED.tract_population,
                low_income_flag = EXCLUDED.low_income_flag,
                low_access_flag = EXCLUDED.low_access_flag,
                low_income_low_access_population = EXCLUDED.low_income_low_access_population,
                low_access_population = EXCLUDED.low_access_population,
                loaded_at = CURRENT_TIMESTAMP;
        """))

    print(f"Loaded {len(fact):,} food access tract records")


if __name__ == "__main__":
    main()
