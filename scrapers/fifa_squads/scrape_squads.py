#!/usr/bin/env python3
"""
Scrape all FIFA World Cup 2026 squad players from fifa.com.

Output: CSV and JSON with player name, country, and position for every
qualified team (up to 48 teams, 26 players each).
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import re
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, sync_playwright

BASE_URL = "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026"
TEAMS_URL = f"{BASE_URL}/teams"

PLAYER_POSITIONS = {"Goalkeeper", "Defender", "Midfielder", "Forward"}

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "output"

# Use project-local browsers when available (avoids sandbox path issues).
_PROJECT_ROOT = SCRIPT_DIR.parent.parent
_LOCAL_BROWSERS = _PROJECT_ROOT / ".playwright-browsers"
if _LOCAL_BROWSERS.exists():
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(_LOCAL_BROWSERS))


@dataclass
class Player:
    name: str
    country: str
    position: str
    team_slug: str


def slug_to_country(slug: str) -> str:
    """Convert URL slug to a readable country name."""
    special = {
        "usa": "USA",
        "bosnia-herzegovina": "Bosnia and Herzegovina",
        "cabo-verde": "Cabo Verde",
        "congo-dr": "Congo DR",
        "cote-d-ivoire": "Côte d'Ivoire",
        "curacao": "Curaçao",
        "ir-iran": "IR Iran",
        "korea-republic": "Korea Republic",
        "new-zealand": "New Zealand",
        "saudi-arabia": "Saudi Arabia",
        "south-africa": "South Africa",
    }
    if slug in special:
        return special[slug]
    return slug.replace("-", " ").title()


def country_from_page(page: Page, team_slug: str) -> str:
    title = page.title()
    match = re.match(r"^(.+?)\s*\|\s*FIFA", title)
    if match:
        return match.group(1).strip()
    return slug_to_country(team_slug)


def dismiss_cookie_banner(page: Page) -> None:
    for selector in (
        "button:has-text('Accept All')",
        "button:has-text('Accept all')",
        "button:has-text('I Accept')",
        "button:has-text('Agree')",
    ):
        button = page.query_selector(selector)
        if button and button.is_visible():
            button.click()
            page.wait_for_timeout(500)
            return


def get_team_urls(page: Page) -> list[tuple[str, str]]:
    """Return (team_slug, team_url) for all World Cup teams."""
    page.goto(TEAMS_URL, wait_until="domcontentloaded")
    dismiss_cookie_banner(page)
    page.wait_for_selector("[class*='team-card']", timeout=60_000)
    page.wait_for_timeout(2_000)

    hrefs: list[str] = page.eval_on_selector_all(
        "a[href*='/teams/']",
        """els => {
            const seen = new Set();
            return els.map(e => e.href).filter(h => {
                const m = h.match(/\\/teams\\/([^/]+)\\/?$/);
                if (!m) return false;
                const slug = m[1];
                if (slug === 'teams' || seen.has(slug)) return false;
                seen.add(slug);
                return true;
            });
        }""",
    )

    teams: list[tuple[str, str]] = []
    for href in hrefs:
        slug = urlparse(href).path.rstrip("/").split("/")[-1]
        teams.append((slug, href))

    return teams


def scrape_team_squad(page: Page, team_slug: str) -> list[Player]:
    squad_url = f"{BASE_URL}/teams/{team_slug}/squad"
    page.goto(squad_url, wait_until="domcontentloaded")
    dismiss_cookie_banner(page)

    try:
        page.wait_for_selector("[class*='entire-squad_container']", timeout=30_000)
    except Exception:
        logging.warning("No squad found for %s", team_slug)
        return []

    page.wait_for_timeout(1_500)
    country = country_from_page(page, team_slug)

    players: list[Player] = []
    containers = page.query_selector_all("[class*='entire-squad_container']")

    for container in containers:
        title_el = container.query_selector("[class*='entire-squad_title']")
        if not title_el:
            continue

        position = title_el.inner_text().strip()
        if position not in PLAYER_POSITIONS:
            continue

        names: list[str] = container.eval_on_selector_all(
            "[class*='player-badge-card_playerName']",
            "els => els.map(e => e.innerText.trim()).filter(Boolean)",
        )

        for name in names:
            players.append(
                Player(
                    name=name,
                    country=country,
                    position=position,
                    team_slug=team_slug,
                )
            )

    return players


def save_csv(players: list[Player], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["name", "country", "position", "team_slug"]
        )
        writer.writeheader()
        for player in players:
            writer.writerow(asdict(player))


def save_json(players: list[Player], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump([asdict(p) for p in players], f, indent=2, ensure_ascii=False)


def scrape_all(
    *,
    headless: bool = True,
    delay_seconds: float = 1.0,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
) -> list[Player]:
    all_players: list[Player] = []

    with sync_playwright() as playwright:
        browser: Browser = playwright.chromium.launch(headless=headless)
        page = browser.new_page()
        page.set_default_timeout(60_000)

        logging.info("Fetching team list from %s", TEAMS_URL)
        teams = get_team_urls(page)
        logging.info("Found %d teams", len(teams))

        for index, (team_slug, team_url) in enumerate(teams, start=1):
            logging.info(
                "[%d/%d] Scraping %s (%s)",
                index,
                len(teams),
                team_slug,
                team_url,
            )
            try:
                players = scrape_team_squad(page, team_slug)
                all_players.extend(players)
                logging.info("  -> %d players", len(players))
            except Exception:
                logging.exception("Failed to scrape %s", team_slug)

            if index < len(teams) and delay_seconds > 0:
                time.sleep(delay_seconds)

        browser.close()

    csv_path = output_dir / "wc2026_players.csv"
    json_path = output_dir / "wc2026_players.json"
    save_csv(all_players, csv_path)
    save_json(all_players, json_path)

    logging.info("Saved %d players to %s", len(all_players), csv_path)
    logging.info("Saved %d players to %s", len(all_players), json_path)

    return all_players


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape FIFA World Cup 2026 squad players from fifa.com"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for output files (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Seconds to wait between team requests (default: 1.0)",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run browser in headed mode (visible window)",
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

    players = scrape_all(
        headless=not args.headed,
        delay_seconds=args.delay,
        output_dir=args.output_dir,
    )

    teams_scraped = len({p.team_slug for p in players})
    print(
        f"\nDone: {len(players)} players from {teams_scraped} teams "
        f"-> {args.output_dir / 'wc2026_players.csv'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
