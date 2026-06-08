"""Shared helpers for eloratings.net scrapers."""

from __future__ import annotations

from pathlib import Path

import requests

BASE_URL = "https://eloratings.net"
TEAMS_TSV_URL = f"{BASE_URL}/en.teams.tsv"
SUCCESSOR_TSV_URL = f"{BASE_URL}/teams.tsv"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def fetch_tsv(url: str) -> list[list[str]]:
    response = requests.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()
    response.encoding = "utf-8"
    rows: list[list[str]] = []
    for line in response.text.splitlines():
        line = line.strip()
        if line:
            rows.append(line.split("\t"))
    return rows


def build_team_dictionary(teams_rows: list[list[str]]) -> dict[str, list[str]]:
    dictionary: dict[str, list[str]] = {}
    for values in teams_rows:
        if not values:
            continue
        code = values[0]
        if code.endswith("_loc"):
            continue
        dictionary[code] = values[1:]
    return dictionary


def build_successor_map(successor_rows: list[list[str]]) -> dict[str, str]:
    return {row[0]: row[1] for row in successor_rows if len(row) >= 2}


def team_name(
    code: str,
    team_dictionary: dict[str, list[str]],
    successor_map: dict[str, str],
) -> str:
    resolved = successor_map.get(code, code)
    names = team_dictionary.get(resolved)
    if not names:
        return code
    return names[0]


def load_team_lookups() -> tuple[dict[str, list[str]], dict[str, str]]:
    team_dictionary = build_team_dictionary(fetch_tsv(TEAMS_TSV_URL))
    successor_map = build_successor_map(fetch_tsv(SUCCESSOR_TSV_URL))
    return team_dictionary, successor_map
