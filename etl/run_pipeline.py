"""
run_pipeline.py — Community Health Intelligence National ETL Orchestrator

Usage:
    python run_pipeline.py --year 2023
    python run_pipeline.py --year 2023 --states TN TX FL   # subset for testing
    python run_pipeline.py --year 2023 --source cdc         # single source

This script coordinates load_cdc_places.py, load_census_acs.py, and
load_food_access.py for all 50 states + DC. It tracks progress so a
failed run can be resumed without re-loading completed states.

Requirements (add to requirements.txt):
    psycopg2-binary
    requests
    pandas
    python-dotenv
    tqdm
    tenacity
"""

import argparse
import logging
import os
import sys
import time
from datetime import datetime
from typing import Optional

import psycopg2
from dotenv import load_dotenv
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Local ETL modules (your existing loaders, updated to accept year + state)
# ---------------------------------------------------------------------------
from load_cdc_places import load_cdc_places
from load_census_acs  import load_census_acs
from load_food_access import load_food_access

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(f"pipeline_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"),
    ],
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# All 50 states + DC — FIPS code : postal abbreviation
# ---------------------------------------------------------------------------
ALL_STATES: dict[str, str] = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
    "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
    "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
    "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
    "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
    "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
    "56": "WY",
}

# USDA Food Access Atlas releases don't happen annually.
# Map each release year to the actual atlas year to use.
FOOD_ACCESS_YEAR_MAP: dict[int, int] = {
    2019: 2019,
    2020: 2019,
    2021: 2019,
    2022: 2019,
    2023: 2019,  # Update this when USDA releases a new atlas
    2024: 2019,
}


def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", 5432)),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )


def already_loaded(conn, source: str, year: int, state_fips: Optional[str]) -> bool:
    """Check the data_loads table to see if this source/year/state is done."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM data_loads
            WHERE source = %s AND year = %s AND state_fips IS NOT DISTINCT FROM %s
            """,
            (source, year, state_fips),
        )
        return cur.fetchone() is not None


def record_load(conn, source: str, year: int, state_fips: Optional[str],
                record_count: int, notes: str = "") -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO data_loads (source, year, state_fips, record_count, notes)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (source, year, state_fips) DO UPDATE
                SET record_count = EXCLUDED.record_count,
                    loaded_at    = now(),
                    notes        = EXCLUDED.notes
            """,
            (source, year, state_fips, record_count, notes),
        )
    conn.commit()


def run_cdc_load(conn, year: int, states: dict[str, str]) -> dict:
    """
    CDC PLACES is distributed as a single national CSV that includes all
    counties, so we load it once per year rather than per state.
    """
    results = {"loaded": 0, "skipped": 0, "errors": []}
    source = "cdc_places"

    if already_loaded(conn, source, year, None):
        log.info(f"CDC PLACES {year} already loaded — skipping")
        results["skipped"] = len(states)
        return results

    log.info(f"Loading CDC PLACES data for year {year} (national file)...")
    try:
        count = load_cdc_places(conn=conn, year=year)
        record_load(conn, source, year, None, count)
        results["loaded"] = count
        log.info(f"  CDC PLACES: {count:,} rows loaded")
    except Exception as exc:
        log.error(f"  CDC PLACES load failed: {exc}")
        results["errors"].append(str(exc))

    return results


def run_census_load(conn, year: int, states: dict[str, str]) -> dict:
    """
    Census ACS is fetched via the Census API per state — it's faster to
    parallelize, but we keep it sequential here for simplicity and to
    avoid hammering the API rate limits.
    """
    results = {"loaded": 0, "skipped": 0, "errors": []}
    source = "census_acs"

    with tqdm(total=len(states), desc=f"Census ACS {year}", unit="state") as pbar:
        for state_fips, state_abbr in states.items():
            pbar.set_postfix(state=state_abbr)

            if already_loaded(conn, source, year, state_fips):
                log.debug(f"  Census {state_abbr} {year} already loaded")
                results["skipped"] += 1
                pbar.update(1)
                continue

            try:
                count = load_census_acs(conn=conn, state_fips=state_fips,
                                        state_abbr=state_abbr, year=year)
                record_load(conn, source, year, state_fips, count)
                results["loaded"] += count
                time.sleep(0.25)          # be polite to the Census API
            except Exception as exc:
                log.error(f"  Census {state_abbr} {year} failed: {exc}")
                results["errors"].append(f"{state_abbr}: {exc}")

            pbar.update(1)

    return results


def run_food_access_load(conn, year: int, states: dict[str, str]) -> dict:
    """
    USDA Food Access is a single national file released every few years.
    We load it once per atlas year and skip states we already have.
    """
    results = {"loaded": 0, "skipped": 0, "errors": []}
    source = "food_access"
    atlas_year = FOOD_ACCESS_YEAR_MAP.get(year, 2019)

    if already_loaded(conn, source, atlas_year, None):
        log.info(f"USDA Food Access {atlas_year} already loaded — skipping")
        results["skipped"] = len(states)
        return results

    log.info(f"Loading USDA Food Access atlas year {atlas_year} (national file)...")
    try:
        count = load_food_access(conn=conn, atlas_year=atlas_year, data_year=year)
        record_load(conn, source, atlas_year, None, count,
                    notes=f"Loaded for pipeline year {year}")
        results["loaded"] = count
        log.info(f"  Food Access: {count:,} rows loaded")
    except Exception as exc:
        log.error(f"  Food Access load failed: {exc}")
        results["errors"].append(str(exc))

    return results


def run_scoring(conn, year: int) -> None:
    """
    Re-runs the scoring stored procedure and trend computation after load.
    Your existing score_counties() proc should accept a year param.
    """
    log.info(f"Running scoring for {year}...")
    with conn.cursor() as cur:
        cur.execute("CALL score_counties(%s);", (year,))
        cur.execute("CALL compute_trends(%s);", (year,))
    conn.commit()
    log.info("Scoring complete.")


def print_summary(results_by_source: dict, year: int, elapsed: float) -> None:
    log.info("\n" + "=" * 60)
    log.info(f"PIPELINE SUMMARY — Year {year}")
    log.info(f"Elapsed: {elapsed:.1f}s")
    log.info("=" * 60)
    total_errors = 0
    for source, r in results_by_source.items():
        log.info(f"  {source:<20} loaded={r['loaded']:>7,}  "
                 f"skipped={r['skipped']:>3}  errors={len(r['errors'])}")
        total_errors += len(r["errors"])
    if total_errors:
        log.warning(f"\n{total_errors} error(s) — check log for details.")
    else:
        log.info("\nAll sources loaded successfully.")
    log.info("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Community Health Intelligence ETL Pipeline")
    parser.add_argument("--year",   type=int, required=True,
                        help="Data year to load (e.g. 2023)")
    parser.add_argument("--states", nargs="*", metavar="ABBR",
                        help="Limit to specific state abbreviations (e.g. TN TX FL)")
    parser.add_argument("--source", choices=["cdc", "census", "food", "all"],
                        default="all", help="Which source to load")
    parser.add_argument("--skip-scoring", action="store_true",
                        help="Skip scoring/trend computation after load")
    parser.add_argument("--force", action="store_true",
                        help="Re-load even if data_loads says it's done")
    args = parser.parse_args()

    # Filter to requested states
    if args.states:
        abbr_set = set(s.upper() for s in args.states)
        states = {fips: abbr for fips, abbr in ALL_STATES.items()
                  if abbr in abbr_set}
        if not states:
            log.error(f"No matching states found for: {args.states}")
            sys.exit(1)
        log.info(f"Targeting {len(states)} state(s): {', '.join(states.values())}")
    else:
        states = ALL_STATES
        log.info(f"Targeting all {len(states)} states + DC")

    conn = get_db_connection()
    t0 = time.time()
    results = {}

    try:
        if args.source in ("cdc", "all"):
            results["CDC PLACES"] = run_cdc_load(conn, args.year, states)

        if args.source in ("census", "all"):
            results["Census ACS"] = run_census_load(conn, args.year, states)

        if args.source in ("food", "all"):
            results["Food Access"] = run_food_access_load(conn, args.year, states)

        if not args.skip_scoring and args.source == "all":
            run_scoring(conn, args.year)

    except KeyboardInterrupt:
        log.warning("\nPipeline interrupted — progress saved in data_loads table.")
        log.info("Re-run the same command to resume where you left off.")
    finally:
        conn.close()

    print_summary(results, args.year, time.time() - t0)

    # Non-zero exit if any errors
    all_errors = sum(len(r["errors"]) for r in results.values())
    sys.exit(1 if all_errors else 0)


if __name__ == "__main__":
    main()
