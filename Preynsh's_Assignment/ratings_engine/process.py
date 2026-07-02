#!/usr/bin/env python3
"""
process.py — one-command rebuild of the PlayerNation ratings.

Runs the whole pipeline end-to-end (the same logic the 01–06 notebooks walk
through, here in one script) and writes `ratings.json` for the web app:

    raw_data/*  ->  master tables  ->  player_match_stats  ->  career stats
                ->  ratings + archetypes  ->  coach profiles  ->  ratings.json

Usage:
    python process.py                # full rebuild
    python process.py -o out.json    # custom output path
    python process.py -v             # debug logging
Then serve the app:
    python -m http.server 8000       # open http://localhost:8000

All heavy logic lives in wyscout_lib.py; this script just orchestrates it.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wyscout_lib as wl

log = logging.getLogger("process")

# authoritative (lineup) vs event-derived goal totals must agree within this
GOAL_SOURCE_TOLERANCE = 0.01


class PipelineValidationError(RuntimeError):
    """A data-quality invariant the pipeline refuses to ship without."""


def build_master_tables() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Phase 1a: players, teams, matches, appearances."""
    players = wl.load_players_master()
    teams = wl.load_teams_master()
    players.to_parquet(wl.DATA / "players_master.parquet")
    teams.to_parquet(wl.DATA / "teams_master.parquet")

    all_matches: list[dict] = []
    all_apps: list[dict] = []
    for comp in wl.COMPETITIONS:
        mrows, arows = wl.build_matches_and_appearances(comp)
        all_matches += mrows
        all_apps += arows
    matches = pd.DataFrame(all_matches)
    appearances = pd.DataFrame(all_apps)
    matches.to_parquet(wl.DATA / "matches_master.parquet")
    appearances.to_parquet(wl.DATA / "player_appearances.parquet")

    if not appearances["minutes_played"].between(0, 120).all():
        raise PipelineValidationError("minutes_played out of [0, 120] range")
    log.info("  %s players · %s matches · %s appearances",
             f"{len(players):,}", f"{len(matches):,}", f"{len(appearances):,}")
    return players, teams, matches, appearances


def build_match_stats(appearances: pd.DataFrame) -> pd.DataFrame:
    """Phase 1b/2: enrich all events, aggregate to player_match_stats."""
    enr_dir = wl.DATA / "events_enriched"
    enr_dir.mkdir(exist_ok=True)
    pms_parts = []
    for comp in wl.COMPETITIONS:
        ev = wl.enrich_events(wl.load_raw_events(comp))
        ev.to_parquet(enr_dir / f"{comp}.parquet")
        apps_c = appearances[appearances["competition_id"] == comp]
        pms_parts.append(wl.build_player_match_stats(apps_c, ev))
        log.info("  %-14s %10s events", comp, f"{len(ev):,}")
        del ev
    pms = pd.concat(pms_parts, ignore_index=True)
    pms.to_parquet(wl.DATA / "player_match_stats.parquet")

    g_auth, g_evt = pms["goals"].sum(), pms["event_goals"].sum()
    if g_auth == 0 or abs(g_auth - g_evt) / g_auth >= GOAL_SOURCE_TOLERANCE:
        raise PipelineValidationError(
            f"goal sources disagree: lineup={g_auth:,}, events={g_evt:,}")
    log.info("  player_match_stats: %s rows · goals %s (event check %s)",
             f"{len(pms):,}", f"{g_auth:,}", f"{g_evt:,}")
    return pms


def run(out_path: Path) -> None:
    t0 = time.time()

    log.info("Phase 1 — loading players / teams / matches / appearances …")
    players, teams, matches, appearances = build_master_tables()

    log.info("Phase 1 — enriching events (3.25M) + Phase 2 — player_match_stats …")
    pms = build_match_stats(appearances)

    log.info("Phase 3 — player_career_stats …")
    career = wl.build_player_career_stats(pms, matches, players)
    career.to_parquet(wl.DATA / "player_career_stats.parquet")
    log.info("  %s rated players", f"{career['is_rated'].sum():,}")

    log.info("Phase 5 — attributes, confidence, archetypes …")
    ratings = wl.build_ratings(career)
    ratings.to_parquet(wl.DATA / "player_ratings.parquet")
    log.info("  Overall: median %.0f, %d players ≥ 90",
             ratings["overall"].median(), int((ratings["overall"] >= 90).sum()))

    log.info("Phase 6 — coach tactical profiles …")
    coaches = wl.build_coach_stats(pms, matches, teams)
    coaches.to_parquet(wl.DATA / "coach_ratings.parquet")
    log.info("  %d coaches (%d with full profile)",
             len(coaches), int(coaches["has_profile"].sum()))

    log.info("Export — %s …", out_path.name)
    payload = wl.export_ratings_json(ratings, coaches, out_path)
    mb = out_path.stat().st_size / 1e6
    log.info("  wrote %s (%.1f MB) — %d players, %d coaches",
             out_path.name, mb, payload["meta"]["n_players"], payload["meta"]["n_coaches"])

    log.info("Done in %.0fs. Run `python -m http.server 8000` "
             "and open http://localhost:8000", time.time() - t0)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Rebuild the PlayerNation ratings from raw_data/.")
    parser.add_argument(
        "-o", "--out", type=Path,
        default=Path(__file__).resolve().parent / "ratings.json",
        help="output path for the web-app payload (default: ./ratings.json)")
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="debug-level logging")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="[%(relativeCreated)8.0fms] %(message)s")

    try:
        run(args.out)
    except PipelineValidationError as exc:
        log.error("Validation failed: %s", exc)
        return 1
    except FileNotFoundError as exc:
        log.error("Missing input: %s — is raw_data/ present at the repo root?", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
