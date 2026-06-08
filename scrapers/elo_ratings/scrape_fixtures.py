#!/usr/bin/env python3
"""
Scrape FIFA World Cup 2026 fixture Elo data from eloratings.net.

Fetches the underlying TSV used by the fixtures SlickGrid table and writes
a CSV with one row per match (tournament games from Jun 11 onward).

Source: https://eloratings.net/2026_World_Cup_fixtures
"""

from __future__ import annotations

import argparse
import calendar
import csv
import logging
import sys
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

from elo_common import BASE_URL, fetch_tsv, load_team_lookups, team_name

WC_FIXTURES_TSV_URL = f"{BASE_URL}/2026_World_Cup_fixtures.tsv"
WC_START = date(2026, 6, 11)

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "output"

CSV_COLUMNS = [
    "date",
    "home_team",
    "home_winning_expectancy",
    "home_current_rank",
    "home_rating",
    "away_team",
    "away_winning_expectancy",
    "away_current_rank",
    "away_rating",
]


@dataclass
class FixtureRow:
    date: str
    home_team: str
    home_winning_expectancy: str
    home_current_rank: int
    home_rating: int
    away_team: str
    away_winning_expectancy: str
    away_current_rank: int
    away_rating: int


def format_date(year: int, month: int, day: int) -> str:
    """Format as 'jun 11' (lowercase 3-letter month, no year)."""
    month_abbr = calendar.month_abbr[month].lower()
    return f"{month_abbr} {day}"


def format_win_expectancy(value: float) -> str:
    if value == int(value):
        return f"{int(value)}%"
    return f"{value}%"


def parse_fixture_date(fields: list[str]) -> date | None:
    if len(fields) < 3:
        return None
    try:
        return date(int(fields[0]), int(fields[1]), int(fields[2]))
    except ValueError:
        return None


def parse_fixtures(
    fixture_rows: list[list[str]],
    team_dictionary: dict[str, list[str]],
    successor_map: dict[str, str],
    *,
    start_date: date = WC_START,
    tournament_type: str = "WC",
) -> list[FixtureRow]:
    """
    Parse fixture rows from 2026_World_Cup_fixtures.tsv.

    Column layout (from eloratings.net/scripts/ratings.js pushFixtureRow):
      0-2: year, month, day
      3-4: team1 code, team2 code
      5:   tournament type (WC = World Cup, F = friendly)
      6:   host country code
      7-8: team1 rank, team2 rank
      9-10: team1 rating, team2 rating
      11:  team1 winning expectancy (%)
    """
    fixtures: list[FixtureRow] = []

    for fields in fixture_rows:
        if len(fields) < 12:
            continue

        match_date = parse_fixture_date(fields)
        if match_date is None or match_date < start_date:
            continue
        if fields[5] != tournament_type:
            continue

        team1_code, team2_code = fields[3], fields[4]
        team1 = team_name(team1_code, team_dictionary, successor_map)
        team2 = team_name(team2_code, team_dictionary, successor_map)

        try:
            rank1, rank2 = int(fields[7]), int(fields[8])
            rating1, rating2 = int(fields[9]), int(fields[10])
            win_exp1 = float(fields[11])
        except ValueError:
            logging.warning("Skipping row with invalid numeric fields: %s", fields)
            continue

        date_str = format_date(match_date.year, match_date.month, match_date.day)
        home_we = format_win_expectancy(win_exp1)
        away_we = format_win_expectancy(100 - win_exp1)

        fixtures.append(
            FixtureRow(
                date=date_str,
                home_team=team1,
                home_winning_expectancy=home_we,
                home_current_rank=rank1,
                home_rating=rating1,
                away_team=team2,
                away_winning_expectancy=away_we,
                away_current_rank=rank2,
                away_rating=rating2,
            )
        )

    return fixtures


def save_csv(fixtures: list[FixtureRow], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for row in fixtures:
            writer.writerow(asdict(row))


def scrape(output_dir: Path = DEFAULT_OUTPUT_DIR) -> list[FixtureRow]:
    logging.info("Fetching fixtures from %s", WC_FIXTURES_TSV_URL)
    fixture_rows = fetch_tsv(WC_FIXTURES_TSV_URL)

    logging.info("Loading team name lookups")
    team_dictionary, successor_map = load_team_lookups()

    fixtures = parse_fixtures(fixture_rows, team_dictionary, successor_map)

    output_path = output_dir / "wc2026_fixtures.csv"
    save_csv(fixtures, output_path)
    logging.info("Saved %d rows to %s", len(fixtures), output_path)

    return fixtures


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape World Cup 2026 fixture Elo data from eloratings.net"
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

    fixtures = scrape(output_dir=args.output_dir)
    print(
        f"\nDone: {len(fixtures)} matches "
        f"-> {args.output_dir / 'wc2026_fixtures.csv'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
