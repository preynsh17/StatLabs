#!/usr/bin/env python3
"""
Scrape FIFA World Cup 2026 Fantasy player prices from play.fifa.com.

Fetches the public players.json feed used by the fantasy game UI and writes
a CSV with display name, full name, position, and price (USD millions).

Source: https://play.fifa.com/fantasy/
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
from dataclasses import dataclass
from pathlib import Path

import requests

PLAYERS_URL = "https://play.fifa.com/json/fantasy/players.json"

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "output"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


POSITION_LABELS = {
    "GK": "Goalkeeper",
    "DEF": "Defender",
    "MID": "Midfielder",
    "FWD": "Forward",
}

CSV_COLUMNS = ["name", "full_name", "position", "price"]


@dataclass
class PlayerPrice:
    name: str
    full_name: str
    position: str
    price: float


def full_name(player: dict) -> str:
    first = (player.get("firstName") or "").strip()
    last = (player.get("lastName") or "").strip()
    return f"{first} {last}".strip()


def display_name(player: dict) -> str:
    """Match the fantasy sidebar: knownName, else last name."""
    known = player.get("knownName")
    if known:
        return known.strip()
    last = (player.get("lastName") or "").strip()
    if last:
        return last
    first = (player.get("firstName") or "").strip()
    return first


def format_price(value: float) -> str | float:
    """Keep integers as int strings in CSV, decimals as one decimal place."""
    if value == int(value):
        return int(value)
    return round(value, 1)


def fetch_players() -> list[dict]:
    response = requests.get(PLAYERS_URL, headers=HEADERS, timeout=30)
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, list):
        raise ValueError("Expected a list of players from players.json")
    return data


def parse_prices(players: list[dict], *, active_only: bool = True) -> list[PlayerPrice]:
    prices: list[PlayerPrice] = []
    for player in players:
        if active_only and player.get("status") != "playing":
            continue
        try:
            price = float(player["price"])
        except (KeyError, TypeError, ValueError):
            logging.warning("Skipping player with invalid price: %s", player)
            continue
        position_code = player.get("position", "")
        position = POSITION_LABELS.get(position_code, position_code)
        prices.append(
            PlayerPrice(
                name=display_name(player),
                full_name=full_name(player),
                position=position,
                price=format_price(price),
            )
        )
    return prices


def save_csv(players: list[PlayerPrice], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for row in players:
            writer.writerow(
                {
                    "name": row.name,
                    "full_name": row.full_name,
                    "position": row.position,
                    "price": row.price,
                }
            )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape FIFA World Cup 2026 fantasy player prices"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for output CSV (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--include-transferred",
        action="store_true",
        help="Include players marked as transferred (default: playing only)",
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

    logging.info("Fetching players from %s", PLAYERS_URL)
    players = fetch_players()
    prices = parse_prices(players, active_only=not args.include_transferred)
    output_path = args.output_dir / "fantasy_prices.csv"
    save_csv(prices, output_path)
    logging.info("Saved %d players to %s", len(prices), output_path)

    print(f"\nDone: {len(prices)} players -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
