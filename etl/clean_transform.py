"""Run post-load transformations."""

import os
from sqlalchemy import create_engine, text


def main() -> None:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is required")

    target_year = int(os.getenv("TARGET_YEAR", "2025"))
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(text("CALL refresh_county_priority_scores(:year)"), {"year": target_year})
    print(f"Refreshed county priority scores for {target_year}")


if __name__ == "__main__":
    main()
