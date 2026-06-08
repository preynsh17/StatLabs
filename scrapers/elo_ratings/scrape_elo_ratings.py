#!/usr/bin/env python3
"""
Scrape FIFA World Cup 2026 Elo ratings from eloratings.net.

Fetches the underlying TSV data used by the site's SlickGrid table and
writes a CSV with Team and Elo rating columns.

Source: https://eloratings.net/2026_World_Cup
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
from dataclasses import dataclass
from pathlib import Path

from elo_common import BASE_URL, fetch_tsv, load_team_lookups, team_name

WC_PAGE = "2026_World_Cup"
WC_TSV_URL = f"{BASE_URL}/{WC_PAGE}.tsv"

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "output"


@dataclass
class TeamRating:
    team: str
    elo_rating: int


def parse_ratings(
    ratings_rows: list[list[str]],
    team_dictionary: dict[str, list[str]],
    successor_map: dict[str, str],
) -> list[TeamRating]:
    """
    Parse rating rows from 2026_World_Cup.tsv.

    Column layout (from eloratings.net/scripts/ratings.js pushRatingRow):
      0: local rank, 1: global rank, 2: team code, 3: rating
    """
    ratings: list[TeamRating] = []
    for fields in ratings_rows:
        if len(fields) < 4:
            continue
        code = fields[2]
        try:
            elo = int(fields[3])
        except ValueError:
            logging.warning("Skipping row with invalid rating: %s", fields)
            continue
        ratings.append(
            TeamRating(
                team=team_name(code, team_dictionary, successor_map),
                elo_rating=elo,
            )
        )
    return ratings


def save_csv(ratings: list[TeamRating], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["Team", "Elo rating"])
        writer.writeheader()
        for row in ratings:
            writer.writerow({"Team": row.team, "Elo rating": row.elo_rating})


def scrape(output_dir: Path = DEFAULT_OUTPUT_DIR) -> list[TeamRating]:
    logging.info("Fetching ratings from %s", WC_TSV_URL)
    ratings_rows = fetch_tsv(WC_TSV_URL)

    team_dictionary, successor_map = load_team_lookups()

    ratings = parse_ratings(ratings_rows, team_dictionary, successor_map)

    output_path = output_dir / "wc2026_elo_ratings.csv"
    save_csv(ratings, output_path)
    logging.info("Saved %d teams to %s", len(ratings), output_path)

    return ratings


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape World Cup 2026 Elo ratings from eloratings.net"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for output CSV (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug logging",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    ratings = scrape(output_dir=args.output_dir)
    print(
        f"\nDone: {len(ratings)} teams "
        f"-> {args.output_dir / 'wc2026_elo_ratings.csv'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
