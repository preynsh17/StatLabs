"""
wyscout_lib.py
==============
Shared data-engineering library for the PlayerNation Ratings Engine.

This module holds every piece of "heavy lifting" so that the notebooks
(01..05) stay short, readable, and focused on *orchestration + display*.

It contains four kinds of things:

  1. CONSTANTS      - competition catalogue, tag decode, period sets.
  2. LOADERS        - read the raw Wyscout files into clean DataFrames.
  3. MINUTES LOGIC  - the single most important calculation in the project.
  4. ENRICHMENT     - turn raw events into one flat, flag-annotated table.
  5. AGGREGATION    - roll events up into player_match_stats.

Design decisions worth knowing before reading the code
-------------------------------------------------------
* GOALS / ASSISTS / OWN GOALS come from the **match lineup metadata**, not
  from event tags. The lineup `goals`/`assists`/`ownGoals` fields are
  authoritative: across the World Cup they sum to 157 goals + 12 own goals
  = 169, the exact official tournament total. Counting event tag 101 instead
  is error-prone because tag 101 also appears on `Save attempt` events
  (goals *conceded*) and on penalty-shootout events. We still compute an
  event-based goal count purely as a cross-check (`event_goals`).

* EXTRA TIME periods are coded "E1"/"E2" (not "ET1"/"ET2"); the penalty
  shootout is period "P". Shootout events never count as competitive goals.

* COORDINATES are team-relative: x=0 is a team's own goal line, x=100 the
  opponent's. So `end_x > start_x + 10` is a progressive pass for every team.
"""

from __future__ import annotations

import json
import logging
import re
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

__all__ = [
    # constants
    "COMPETITIONS", "COMP_LABELS", "POSITIONS", "ATTRIBUTES",
    "ATTR_LABELS", "GK_ATTR_LABELS", "OVERALL_WEIGHTS",
    "REGULAR_PERIODS", "EXTRA_TIME_PERIODS", "SHOOTOUT_PERIOD",
    "TAG_ACCURATE", "TAG_INACCURATE", "TAG_GOAL", "TAG_ON_TARGET",
    "TAG_SHOT_SAVED", "TAG_KEY_PASS", "TAG_ASSIST",
    "TAG_POSSESSION_RETAINED", "TAG_HEADER",
    "MIN_MINUTES_RATED", "CONFIDENCE_K",
    "COACH_MIN_MATCHES_PROFILE", "COACH_SHRINK_K",
    "RAW", "DATA",
    # loaders
    "load_players_master", "load_teams_master",
    "load_raw_matches", "load_raw_events",
    # pipeline stages
    "build_matches_and_appearances", "enrich_events",
    "aggregate_events_to_match", "build_player_match_stats",
    "build_player_career_stats", "build_ratings", "build_coach_stats",
    # scoring helpers
    "fifa_scale", "confidence_stars", "coach_confidence_stars",
    "assign_archetype",
    # export
    "export_ratings_json",
]

# The source JSON double-escapes accented names, so a value like "Aréola"
# arrives as the literal 6-char sequence "Aréola" (899 of 3,603 players,
# plus several nationalities like "Côte d'Ivoire"). Decode \uXXXX back to the
# real character so cards read correctly.
_UNICODE_ESCAPE = re.compile(r"\\u([0-9a-fA-F]{4})")


def _decode_name(s: Any) -> Any:
    """Decode literal '\\uXXXX' sequences left in the source JSON strings."""
    if not isinstance(s, str) or "\\u" not in s:
        return s
    return _UNICODE_ESCAPE.sub(lambda m: chr(int(m.group(1), 16)), s)

# --------------------------------------------------------------------------
# Paths  (this file lives in ratings_engine/, raw data is two levels up)
# --------------------------------------------------------------------------
LIB_DIR = Path(__file__).resolve().parent
REPO_ROOT = LIB_DIR.parent.parent
RAW = REPO_ROOT / "raw_data"
DATA = LIB_DIR / "data"            # cached parquet outputs live here
DATA.mkdir(exist_ok=True)

EVENTS_ZIP = RAW / "events.zip"
MATCHES_ZIP = RAW / "matches.zip"
PLAYERS_JSON = RAW / "players.json"
TEAMS_JSON = RAW / "teams.json"

# --------------------------------------------------------------------------
# 1. CONSTANTS
# --------------------------------------------------------------------------

# competition_id (our slug) -> metadata. The `file` is the stem inside the zips.
COMPETITIONS = {
    "england":  {"file": "England",               "name": "English Premier League", "season": "2017/18", "type": "league",     "wy_competition_id": 364},
    "france":   {"file": "France",                "name": "French Ligue 1",         "season": "2017/18", "type": "league",     "wy_competition_id": 412},
    "germany":  {"file": "Germany",               "name": "German Bundesliga",      "season": "2017/18", "type": "league",     "wy_competition_id": 426},
    "italy":    {"file": "Italy",                 "name": "Italian Serie A",        "season": "2017/18", "type": "league",     "wy_competition_id": 524},
    "spain":    {"file": "Spain",                 "name": "Spanish La Liga",        "season": "2017/18", "type": "league",     "wy_competition_id": 795},
    "euro_2016": {"file": "European_Championship", "name": "UEFA Euro 2016",         "season": "2016",    "type": "tournament", "wy_competition_id": 102},
    "world_cup": {"file": "World_Cup",            "name": "FIFA World Cup 2018",    "season": "2018",    "type": "tournament", "wy_competition_id": 28},
}

# Tag decode (only the tags we actually rely on).
TAG_ACCURATE = 1801   # technically accurate action (NOT "duel won" - see note)
TAG_INACCURATE = 1802
TAG_GOAL = 101        # goal — but ALSO appears on Save attempt (conceded) & shootouts
TAG_ON_TARGET = 401   # shot on target family
TAG_SHOT_SAVED = 402  # shot saved by keeper (i.e. on target)
TAG_KEY_PASS = 302    # pass directly preceding a shot
TAG_ASSIST = 301      # pass/action directly preceding a goal
TAG_POSSESSION_RETAINED = 1401
TAG_HEADER = 403      # shot taken with the head/body (401/402 = right/left foot)

REGULAR_PERIODS = {"1H", "2H"}
EXTRA_TIME_PERIODS = {"E1", "E2"}
SHOOTOUT_PERIOD = "P"

POSITIONS = ["GK", "DF", "MD", "FW"]


def _as_int(value: Any, default: int | None = 0) -> int | None:
    """Wyscout stores some counts as strings ('0','null'). Parse defensively."""
    try:
        if value in (None, "null", ""):
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------
# 2. LOADERS
# --------------------------------------------------------------------------

def load_players_master() -> pd.DataFrame:
    """One row per player: biographical metadata + the GK/DF/MD/FW position code."""
    with open(PLAYERS_JSON, encoding="utf-8") as f:
        players = json.load(f)

    rows = []
    for p in players:
        rows.append({
            "player_id": p["wyId"],
            "first_name": _decode_name(p.get("firstName", "")),
            "last_name": _decode_name(p.get("lastName", "")),
            "short_name": _decode_name(p.get("shortName", "")),
            "birth_date": p.get("birthDate"),
            "nationality": _decode_name((p.get("passportArea") or {}).get("name")),
            "position_code": (p.get("role") or {}).get("code2"),
            "height_cm": p.get("height") or None,
            "weight_kg": p.get("weight") or None,
            "preferred_foot": p.get("foot") if p.get("foot") not in ("", "null", None) else None,
            "current_team_id": _as_int(p.get("currentTeamId"), default=None),
        })
    df = pd.DataFrame(rows)
    if not df["player_id"].is_unique:
        raise ValueError("players.json contains duplicate player ids")
    # nullable integer dtype keeps parquet happy when some ids are missing
    df["current_team_id"] = df["current_team_id"].astype("Int64")
    df["height_cm"] = pd.to_numeric(df["height_cm"], errors="coerce").astype("Int64")
    df["weight_kg"] = pd.to_numeric(df["weight_kg"], errors="coerce").astype("Int64")
    return df


def load_teams_master() -> pd.DataFrame:
    """One row per team (clubs + national teams)."""
    with open(TEAMS_JSON, encoding="utf-8") as f:
        teams = json.load(f)
    rows = [{
        "team_id": t["wyId"],
        "team_name": _decode_name(t.get("name")),
        "official_name": _decode_name(t.get("officialName")),
        "team_type": t.get("type"),          # 'club' or 'national'
        "area": _decode_name((t.get("area") or {}).get("name")),
    } for t in teams]
    return pd.DataFrame(rows)


def _read_zip_json(zip_path: Path, member_stem: str) -> list[dict]:
    """Read matches_<stem>.json / events_<stem>.json from inside a zip."""
    # zip member names are like 'matches_England.json' / 'events_England.json'
    prefix = "matches" if "matches" in zip_path.name else "events"
    member = f"{prefix}_{member_stem}.json"
    with zipfile.ZipFile(zip_path) as z, z.open(member) as f:
        return json.load(f)


def load_raw_matches(competition_id: str) -> list[dict]:
    """Raw match dicts for one competition."""
    stem = COMPETITIONS[competition_id]["file"]
    return _read_zip_json(MATCHES_ZIP, stem)


def load_raw_events(competition_id: str) -> list[dict]:
    """Raw event dicts for one competition (can be large: up to ~190MB JSON)."""
    stem = COMPETITIONS[competition_id]["file"]
    return _read_zip_json(EVENTS_ZIP, stem)


# --------------------------------------------------------------------------
# 3. MINUTES LOGIC + match/appearance tables
# --------------------------------------------------------------------------

def _match_has_extra_time(team_entries: dict) -> bool:
    """A match went to extra time if any side recorded an ET score."""
    for td in team_entries.values():
        et = td.get("scoreET")
        if et not in (None, "null", 0, "0"):
            return True
    return False


def build_matches_and_appearances(competition_id: str) -> tuple[list[dict], list[dict]]:
    """
    Returns (matches_rows, appearance_rows) for one competition.

    matches_rows      -> one row per match (scores, coaches, ET/penalty flags)
    appearance_rows   -> one row per (player, match) who was in lineup or bench,
                         carrying minutes_played and the authoritative
                         goals / assists / own_goals / cards from the lineup.
    """
    meta = COMPETITIONS[competition_id]
    raw = load_raw_matches(competition_id)

    match_rows, appearance_rows = [], []

    for m in raw:
        match_id = m["wyId"]
        team_entries = m["teamsData"]
        has_et = _match_has_extra_time(team_entries)
        max_minutes = 120 if has_et else 90
        has_pens = any(td.get("scoreP") not in (None, "null", 0, "0") for td in team_entries.values())

        # ---- match-level row -------------------------------------------------
        sides = {td["side"]: td for td in team_entries.values()}
        home = sides.get("home") or list(team_entries.values())[0]
        away = sides.get("away") or list(team_entries.values())[1]
        home_score, away_score = _as_int(home.get("score")), _as_int(away.get("score"))
        if home_score > away_score:
            winner = home["teamId"]
        elif away_score > home_score:
            winner = away["teamId"]
        else:
            winner = None

        match_rows.append({
            "match_id": match_id,
            "competition_id": competition_id,
            "date_utc": m.get("dateutc"),
            "label": m.get("label"),
            "round_id": m.get("roundId"),
            "gameweek": m.get("gameweek"),
            "group_name": m.get("groupName"),
            "home_team_id": home["teamId"],
            "away_team_id": away["teamId"],
            "home_score": home_score,
            "away_score": away_score,
            "winner_team_id": winner,
            "has_extra_time": has_et,
            "has_penalties": has_pens,
            "home_coach_id": home.get("coachId") or None,
            "away_coach_id": away.get("coachId") or None,
        })

        # ---- per-player appearance rows -------------------------------------
        for td in team_entries.values():
            team_id = td["teamId"]
            formation = td.get("formation") or {}
            subs = formation.get("substitutions") or []
            if subs in ("null", None):
                subs = []

            # map playerId -> sub-on / sub-off absolute minute
            sub_on, sub_off = {}, {}
            for s in subs:
                if not isinstance(s, dict):
                    continue
                minute = _as_int(s.get("minute"), default=None) if s.get("minute") is not None else None
                if s.get("playerIn"):
                    sub_on.setdefault(s["playerIn"], minute)
                if s.get("playerOut"):
                    sub_off.setdefault(s["playerOut"], minute)

            def make_row(entry, started: bool):
                pid = entry["playerId"]
                on_min = 0 if started else sub_on.get(pid)
                off_min = sub_off.get(pid)

                # NOTE on encoding: in this V1 data the per-player lineup fields
                # are NOT all counts. `goals` IS a reliable count (it agrees with
                # event tag 101 to ~100%). But `yellowCards`/`redCards` store the
                # *minute* the card was shown (0 = none), and `assists`/`ownGoals`
                # are unreliable in the leagues. So: goals -> count; cards -> 0/1
                # occurrence; assists -> derived from events later; ownGoals dropped.
                red_minute = _as_int(entry.get("redCards"))   # minute, or 0

                if started:
                    end_min = off_min if off_min is not None else max_minutes
                    # a starter sent off (and not subbed) leaves the pitch then
                    if red_minute > 0 and off_min is None:
                        end_min = min(end_min, red_minute)
                    minutes = max(0, end_min - 0)
                elif on_min is not None:           # came off the bench
                    end_min = off_min if off_min is not None else max_minutes
                    if red_minute > 0 and off_min is None:
                        end_min = min(end_min, red_minute)
                    minutes = max(0, end_min - on_min)
                else:                               # unused substitute
                    minutes = 0

                # clamp (guards against stray sub minutes > match length)
                minutes = float(min(minutes, max_minutes))

                return {
                    "player_id": pid,
                    "match_id": match_id,
                    "competition_id": competition_id,
                    "team_id": team_id,
                    "started": started,
                    "minutes_played": minutes,
                    "subbed_on_minute": on_min if (not started and on_min is not None) else None,
                    "subbed_off_minute": off_min,
                    "goals": _as_int(entry.get("goals")),           # authoritative count
                    "yellow_card": 1 if _as_int(entry.get("yellowCards")) > 0 else 0,
                    "red_card": 1 if red_minute > 0 else 0,
                }

            for e in formation.get("lineup", []) or []:
                appearance_rows.append(make_row(e, started=True))
            for e in formation.get("bench", []) or []:
                appearance_rows.append(make_row(e, started=False))

    return match_rows, appearance_rows


# --------------------------------------------------------------------------
# 4. EVENT ENRICHMENT  (raw events -> one flat, flag-annotated table)
# --------------------------------------------------------------------------

def enrich_events(raw_events: list[dict]) -> pd.DataFrame:
    """
    Flatten + enrich raw events in a single pass.

    Each output row is one event with:
      * flat ids (match/team/player/period)
      * start/end coordinates
      * boolean flags used downstream (accurate, goal, key pass, progressive...)

    Doing the flag computation here (during flattening) keeps it fast and
    means player_match_stats is a pure groupby with no per-row Python.
    """
    out = []
    for e in raw_events:
        tag_ids = {t["id"] for t in e.get("tags", [])}
        positions = e.get("positions") or []
        sx = positions[0]["x"] if len(positions) >= 1 else None
        sy = positions[0]["y"] if len(positions) >= 1 else None
        ex = positions[1]["x"] if len(positions) >= 2 else sx
        ey = positions[1]["y"] if len(positions) >= 2 else sy

        ev = e["eventName"]
        sub = e.get("subEventName", "")
        period = e["matchPeriod"]
        is_pass = ev == "Pass"
        is_shot = ev == "Shot"

        accurate = TAG_ACCURATE in tag_ids
        # event-based goal cross-check: tag 101 on a Shot/Free Kick, not in shootout
        event_goal = (TAG_GOAL in tag_ids) and (ev in ("Shot", "Free Kick")) and (period != SHOOTOUT_PERIOD)

        shot_distance = None
        if is_shot and sx is not None:
            shot_distance = float(np.hypot(100 - sx, 50 - sy))

        out.append({
            "event_id": e["id"],
            "match_id": e["matchId"],
            "team_id": e["teamId"],
            "player_id": e["playerId"],
            "period": period,
            "event_sec": e.get("eventSec"),
            "event_name": ev,
            "sub_event_name": sub,
            "start_x": sx, "start_y": sy, "end_x": ex, "end_y": ey,
            # ---- flags ----
            "is_accurate": accurate,
            "is_pass": is_pass,
            "pass_accurate": is_pass and accurate,
            "is_progressive_pass": is_pass and (ex is not None) and (ex > sx + 10),
            "is_final_third_pass": is_pass and (ex is not None) and (ex > 66),
            "is_into_box_pass": is_pass and (ex is not None) and (ex > 83) and (21 < ey < 79),
            "is_key_pass": is_pass and (TAG_KEY_PASS in tag_ids),
            "is_assist": TAG_ASSIST in tag_ids,     # event-derived assist (uniform across comps)
            "is_smart_pass": sub == "Smart pass",
            "is_cross": sub in ("Cross", "Free kick cross"),
            "cross_accurate": (sub in ("Cross", "Free kick cross")) and accurate,
            "is_shot": is_shot,
            # on a Shot, tag 1801 (accurate) == on target. Every shot carries
            # exactly one of 1801/1802 and every goal carries 1801, so this is
            # the correct on-target signal.
            "shot_on_target": is_shot and accurate,
            "event_goal": event_goal,
            # header shots & goals (tag 403 = head/body; verified ~20% of goals)
            "header_shot": is_shot and (TAG_HEADER in tag_ids),
            "header_goal": event_goal and (TAG_HEADER in tag_ids),
            "shot_distance": shot_distance,
            "is_duel": ev == "Duel",
            "is_defensive_duel": sub == "Ground defending duel",
            "is_aerial_duel": sub == "Air duel",
            "is_attacking_duel": sub == "Ground attacking duel",
            "is_clearance": sub == "Clearance",
            "clearance_accurate": (sub == "Clearance") and accurate,
            "is_foul": ev == "Foul",
            "possession_retained": TAG_POSSESSION_RETAINED in tag_ids,
            "is_acceleration": sub == "Acceleration",
            "is_touch": sub == "Touch",
            "is_save_attempt": ev == "Save attempt",
            "is_reflexes": sub == "Reflexes",
            "is_goal_kick": sub == "Goal kick",
            "goal_kick_accurate": (sub == "Goal kick") and accurate,
        })

    df = pd.DataFrame(out)
    return df


# --------------------------------------------------------------------------
# 5. AGGREGATION  (events_enriched -> player_match_stats)
# --------------------------------------------------------------------------

# (flag column -> output column) sums computed per (match, player)
_SUM_FLAGS = {
    "pass_total": "is_pass",
    "pass_accurate": "pass_accurate",
    "progressive_passes": "is_progressive_pass",
    "final_third_passes": "is_final_third_pass",
    "into_box_passes": "is_into_box_pass",
    "key_passes": "is_key_pass",
    "assists": "is_assist",
    "smart_passes": "is_smart_pass",
    "crosses": "is_cross",
    "crosses_accurate": "cross_accurate",
    "shots_total": "is_shot",
    "shots_on_target": "shot_on_target",
    "event_goals": "event_goal",
    "header_shots": "header_shot",
    "header_goals": "header_goal",
    "duels_total": "is_duel",
    "defensive_duels": "is_defensive_duel",
    "aerial_duels": "is_aerial_duel",
    "attacking_duels": "is_attacking_duel",
    "clearances": "is_clearance",
    "clearances_accurate": "clearance_accurate",
    "fouls": "is_foul",
    "possession_retained": "possession_retained",
    "accelerations": "is_acceleration",
    "touches": "is_touch",
    "saves": "is_save_attempt",
    "reflexes": "is_reflexes",
    "goal_kicks": "is_goal_kick",
    "goal_kicks_accurate": "goal_kick_accurate",
}


def aggregate_events_to_match(events_df: pd.DataFrame) -> pd.DataFrame:
    """Group enriched events by (match_id, player_id) into per-match counting stats."""
    g = events_df.groupby(["match_id", "player_id"], sort=False)

    agg = g.agg(
        total_events=("event_id", "size"),
        shot_distance_sum=("shot_distance", "sum"),
        **{out: (col, "sum") for out, col in _SUM_FLAGS.items()},
    ).reset_index()

    # average shot distance (only meaningful where shots were taken)
    agg["shot_distance_avg"] = np.where(
        agg["shots_total"] > 0, agg["shot_distance_sum"] / agg["shots_total"], np.nan
    )
    agg = agg.drop(columns=["shot_distance_sum"])
    return agg


def build_player_match_stats(appearances_df: pd.DataFrame,
                             events_df: pd.DataFrame) -> pd.DataFrame:
    """
    Join authoritative appearance data (minutes, goals, assists, cards) with
    event-aggregated counting stats -> the atomic player_match_stats table.

    Spine = appearances with minutes_played > 0 (i.e. players who actually
    played). Event stats are left-joined on. `goals` stays authoritative
    (from lineup); `event_goals` is kept alongside purely for validation.
    """
    spine = appearances_df[appearances_df["minutes_played"] > 0].copy()
    ev_agg = aggregate_events_to_match(events_df)

    pms = spine.merge(ev_agg, on=["match_id", "player_id"], how="left")

    # players with minutes but no events -> fill counting stats with 0
    count_cols = list(_SUM_FLAGS.keys()) + ["total_events"]
    pms[count_cols] = pms[count_cols].fillna(0).astype("int64")

    return pms


# --------------------------------------------------------------------------
# 6. CAREER AGGREGATION  (player_match_stats -> player_career_stats)
# --------------------------------------------------------------------------

# counting stats that get summed across a player's matches, then turned per-90
_CAREER_COUNT_COLS = list(_SUM_FLAGS.keys()) + ["total_events", "goals"]

# columns that become a per-90 rate: career_col -> "<name>_p90"
_PER90_COLS = [
    "pass_total", "progressive_passes", "final_third_passes", "into_box_passes",
    "smart_passes", "key_passes", "assists", "crosses",
    "shots_total", "shots_on_target", "goals",
    "duels_total", "defensive_duels", "aerial_duels", "attacking_duels",
    "clearances", "possession_retained", "accelerations", "touches", "fouls",
    "saves", "reflexes", "total_events", "header_goals",
]

MIN_MINUTES_RATED = 45   # below this a player is not rated (too little signal)


def _safe_ratio(num: pd.Series, den: pd.Series) -> pd.Series:
    """Element-wise num/den with 0-denominators mapped to NaN, never raising."""
    den = den.replace(0, np.nan)
    return num / den


def build_player_career_stats(pms: pd.DataFrame,
                              matches: pd.DataFrame,
                              players: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregate the atomic table to one row per player.

    Produces: total minutes/matches, summed counting stats, per-90 versions,
    accuracy rates, goalkeeper save% (needs goals conceded), the list of
    competitions a player featured in, and an `is_rated` flag. **No ratings.**
    """
    df = pms.copy()

    # goals conceded per appearance (for GK save%): the opponent's score that match
    mm = matches.set_index("match_id")[["home_team_id", "away_team_id",
                                         "home_score", "away_score"]]
    df = df.join(mm, on="match_id")
    df["conceded"] = np.where(df["team_id"] == df["home_team_id"],
                              df["away_score"], df["home_score"])
    df["clean_sheet"] = (df["conceded"] == 0).astype(int)   # GK metric

    # --- team possession proxy (pass share) -> defensive opportunity ----------
    # A defender on a possession-dominant team simply has fewer chances to make
    # defensive actions; we capture that to fairly compare defenders (B4).
    team_passes = pms.groupby(["match_id", "team_id"])["pass_total"].sum()
    match_passes = pms.groupby("match_id")["pass_total"].sum()
    poss = team_passes.div(match_passes, level="match_id").rename("poss_share").reset_index()
    df = df.merge(poss, on=["match_id", "team_id"], how="left")
    df["opp_share"] = 1.0 - df["poss_share"]          # how much the OPPONENT had the ball
    df["opp_share_min"] = df["opp_share"] * df["minutes_played"]

    # weighted shot-distance numerator (avg * count) to re-derive a career avg
    df["shot_distance_num"] = df["shot_distance_avg"].fillna(0) * df["shots_total"]

    agg_spec = {c: (c, "sum") for c in _CAREER_COUNT_COLS}
    agg_spec.update({
        "minutes_played": ("minutes_played", "sum"),
        "matches_played": ("match_id", "nunique"),
        "conceded": ("conceded", "sum"),
        "clean_sheets": ("clean_sheet", "sum"),
        "shot_distance_num": ("shot_distance_num", "sum"),
        "opp_share_min": ("opp_share_min", "sum"),
        "yellow_cards": ("yellow_card", "sum"),
        "red_cards": ("red_card", "sum"),
    })
    car = df.groupby("player_id", sort=False).agg(**agg_spec).reset_index()

    # competitions featured in
    comps = (df.groupby("player_id")["competition_id"]
               .agg(lambda s: sorted(set(s))).rename("competitions").reset_index())
    car = car.merge(comps, on="player_id")
    car["n_competitions"] = car["competitions"].str.len()

    # per-90 metrics
    factor = 90.0 / car["minutes_played"]
    for c in _PER90_COLS:
        car[f"{c}_p90"] = car[c] * factor

    # accuracy rates
    car["pass_completion_pct"] = _safe_ratio(car["pass_accurate"], car["pass_total"])
    car["shot_accuracy_pct"] = _safe_ratio(car["shots_on_target"], car["shots_total"])
    car["clearance_accuracy_pct"] = _safe_ratio(car["clearances_accurate"], car["clearances"])
    car["cross_accuracy_pct"] = _safe_ratio(car["crosses_accurate"], car["crosses"])
    car["goal_kick_accuracy_pct"] = _safe_ratio(car["goal_kicks_accurate"], car["goal_kicks"])
    car["save_pct"] = _safe_ratio(car["saves"], car["saves"] + car["conceded"])
    car["clean_sheet_rate"] = _safe_ratio(car["clean_sheets"], car["matches_played"])
    car["shot_distance_avg"] = _safe_ratio(car["shot_distance_num"], car["shots_total"])
    car = car.drop(columns=["shot_distance_num"])

    # minutes-weighted opponent-possession share, then possession-ADJUSTED
    # defensive volume: divide a player's defensive rate by their share of
    # defensive opportunity (clipped 0.35-0.65) so dominant-team defenders are
    # not punished for simply having the ball more. Scale ~1.0 on average.
    car["opp_possession_share"] = _safe_ratio(car["opp_share_min"], car["minutes_played"])
    car = car.drop(columns=["opp_share_min"])
    adj_factor = 0.5 / car["opp_possession_share"].clip(0.35, 0.65)
    for c in ["clearances_p90", "defensive_duels_p90", "possession_retained_p90"]:
        car[f"{c}_adj"] = car[c] * adj_factor

    # biographical join
    car = car.merge(
        players[["player_id", "short_name", "first_name", "last_name",
                 "nationality", "position_code", "height_cm", "weight_kg",
                 "preferred_foot"]],
        on="player_id", how="left")

    car["is_rated"] = car["minutes_played"] >= MIN_MINUTES_RATED

    # a few derived ratios the rating attributes consume
    car["final_third_pass_rate"] = _safe_ratio(car["final_third_passes"], car["pass_total"])
    car["pass_richness"] = _safe_ratio(car["smart_passes"] + car["crosses"], car["pass_total"])
    return car


# ==========================================================================
# 7. RATINGS  (player_career_stats -> attribute scores, confidence, archetypes)
# ==========================================================================
#
# Every attribute is a weighted blend of sub-metrics. Each sub-metric is turned
# into a PERCENTILE RANK *within the player's position group* (GK/DF/MD/FW), so
# we never compare a centre-back's passing to a winger's finishing. Rate-based
# sub-metrics (accuracy %, save %) require a minimum denominator before they
# count — otherwise "1 from 1" would read as perfect.
#
# Spec entry = (career_column, weight, higher_is_better, denom_column, min_denom)

_OUTFIELD_SPECS = {
    "passing": [
        ("pass_completion_pct",     0.35, True,  "pass_total", 20),
        ("progressive_passes_p90",  0.30, True,  None, 0),
        ("final_third_pass_rate",   0.20, True,  "pass_total", 20),
        ("pass_richness",           0.15, True,  "pass_total", 20),
    ],
    "creativity": [
        ("final_third_passes_p90",  0.30, True,  None, 0),
        ("into_box_passes_p90",     0.25, True,  None, 0),
        ("smart_passes_p90",        0.25, True,  None, 0),
        ("key_passes_p90",          0.20, True,  None, 0),
    ],
    "finishing": [
        ("goals_p90",               0.40, True,  None, 0),
        ("shot_accuracy_pct",       0.30, True,  "shots_total", 5),
        ("shots_on_target_p90",     0.20, True,  None, 0),
        ("shot_distance_avg",       0.10, False, "shots_total", 5),
    ],
    "defending": [
        # possession-ADJUSTED volume (fair to dominant-team defenders) + an
        # aerial goal-threat term so set-piece header scorers get credit.
        ("clearances_p90_adj",          0.25, True,  None, 0),
        ("clearance_accuracy_pct",      0.15, True,  "clearances", 5),
        ("possession_retained_p90_adj", 0.20, True,  None, 0),
        ("defensive_duels_p90_adj",     0.15, True,  None, 0),
        ("aerial_duels_p90",            0.15, True,  None, 0),
        ("header_goals_p90",            0.10, True,  None, 0),
    ],
    "work_rate": [
        ("total_events_p90",        0.60, True,  None, 0),
        ("duels_total_p90",         0.40, True,  None, 0),
    ],
}

# Goalkeepers reuse passing/defending/work_rate but redefine the
# creativity slot as DISTRIBUTION and the finishing slot as SHOT STOPPING.
_GK_SPECS = {
    "passing":    _OUTFIELD_SPECS["passing"],
    "creativity": [   # -> DISTRIBUTION
        ("goal_kick_accuracy_pct",  0.40, True,  "goal_kicks", 5),
        ("pass_completion_pct",     0.40, True,  "pass_total", 20),
        ("progressive_passes_p90",  0.20, True,  None, 0),
    ],
    "finishing": [    # -> SHOT STOPPING. save% is a RATE (team-context neutral)
        # so it leads; clean sheets reward keeping goals out; saves/reflexes are
        # volume (confounded by how often a keeper is tested) so weighted light.
        ("save_pct",                0.55, True,  "saves", 5),
        ("clean_sheet_rate",        0.20, True,  None, 0),
        ("saves_p90",               0.15, True,  None, 0),
        ("reflexes_p90",            0.10, True,  None, 0),
    ],
    "defending":  _OUTFIELD_SPECS["defending"],
    "work_rate":  _OUTFIELD_SPECS["work_rate"],
}

ATTRIBUTES = ["passing", "creativity", "finishing", "defending", "work_rate"]

# display labels (GK overrides two slots)
ATTR_LABELS = {
    "passing": "PASSING", "creativity": "CREATIVITY", "finishing": "FINISHING",
    "defending": "DEFENDING", "work_rate": "WORK RATE",
}
GK_ATTR_LABELS = dict(ATTR_LABELS, creativity="DISTRIBUTION", finishing="SHOT STOPPING")

# Overall = position-weighted blend of the five attribute scores.
OVERALL_WEIGHTS = {
    # GK overall leans on QUALITY signals (shot-stopping save%, distribution
    # accuracy, passing accuracy). Defending/work-rate for a keeper are mostly
    # event-volume noise confounded by team dominance, so they barely count.
    "GK": {"passing": .15, "creativity": .26, "finishing": .55, "defending": .02, "work_rate": .02},
    # work-rate kept low for DF: it is volume-based and correlates with
    # DEFENDING, so a high weight double-rewards merely "busy" defenders.
    "DF": {"passing": .25, "creativity": .10, "finishing": .05, "defending": .52, "work_rate": .08},
    "MD": {"passing": .25, "creativity": .25, "finishing": .10, "defending": .20, "work_rate": .20},
    "FW": {"passing": .20, "creativity": .25, "finishing": .35, "defending": .05, "work_rate": .15},
}

CONFIDENCE_K = 180   # minutes at which a player is weighted 50/50 vs the prior


def _percentile_within(series: pd.Series, group: pd.Series, higher_is_better: bool) -> pd.Series:
    """Percentile rank (0..1) of each value within its position group."""
    s = series if higher_is_better else -series
    return s.groupby(group).rank(pct=True)


def _attr_score_0_99(pct: pd.Series) -> pd.Series:
    return (pct * 99).round().clip(lower=1, upper=99)


def build_ratings(career: pd.DataFrame) -> pd.DataFrame:
    """
    Turn career features into the final rating table:
      <attr>_score (0-99, Bayesian-adjusted) + <attr>_raw + <attr>_insufficient,
      overall, confidence_stars, archetype, strengths, improvements.

    Only rated players (>= 45 min) are scored; percentiles are computed within
    each GK/DF/MD/FW peer group.
    """
    df = career[career.is_rated].copy().reset_index(drop=True)
    pos = df["position_code"]
    is_gk = pos == "GK"

    # ---- 1. raw percentile score per attribute --------------------------
    for attr in ATTRIBUTES:
        # build weighted blend of available sub-metric percentiles, per player
        weighted_sum = pd.Series(0.0, index=df.index)
        weight_avail = pd.Series(0.0, index=df.index)

        # outfield players and GKs can use different specs for the same slot
        for spec_mask, specs in ((~is_gk, _OUTFIELD_SPECS), (is_gk, _GK_SPECS)):
            if not spec_mask.any():
                continue
            for col, w, hib, denom_col, min_denom in specs[attr]:
                vals = df[col].copy()
                if denom_col is not None:        # gate rate metrics on volume
                    vals = vals.where(df[denom_col] >= min_denom)
                vals = vals.where(spec_mask)     # only this position bucket
                pct = _percentile_within(vals, pos, hib)
                ok = pct.notna()
                weighted_sum = weighted_sum.add(pct.fillna(0) * w * ok, fill_value=0)
                weight_avail = weight_avail.add(w * ok, fill_value=0)

        raw_pct = (weighted_sum / weight_avail.replace(0, np.nan))
        df[f"{attr}_raw"] = _attr_score_0_99(raw_pct)

    # by default every attribute has enough signal; flag the exceptions
    for attr in ATTRIBUTES:
        df[f"{attr}_insufficient"] = False
    # an outfielder who barely shoots has no real "finishing" -> show "—"
    df["finishing_insufficient"] = (~is_gk) & (df["shots_total"] < 3)
    # a keeper who barely distributed has no real "distribution" score
    df.loc[is_gk & (df["pass_total"] < 20), "creativity_insufficient"] = True

    # ---- 2. Bayesian confidence shrinkage toward the position mean ------
    minutes = df["minutes_played"]
    weight = minutes / (minutes + CONFIDENCE_K)
    for attr in ATTRIBUTES:
        prior = df.groupby(pos)[f"{attr}_raw"].transform("mean")
        df[f"{attr}_score"] = (weight * df[f"{attr}_raw"] + (1 - weight) * prior).round().astype(int)

    # ---- 3. overall = position-weighted blend of adjusted scores --------
    overall = pd.Series(0.0, index=df.index)
    for p, wmap in OVERALL_WEIGHTS.items():
        m = pos == p
        if not m.any():
            continue
        sub = sum(df.loc[m, f"{a}_score"] * w for a, w in wmap.items())
        overall.loc[m] = sub
    # honest blend (compressed ~28-83, position-balanced) -> ranks the players
    df["overall_raw"] = overall.round().astype(int)
    # display Overall: re-percentile onto a FIFA-shaped curve so the card reads
    # like a real rating (median ~73, only the elite reach 90+). See B3.
    df["overall"] = fifa_scale(df["overall_raw"])

    # ---- 4. confidence stars from minutes -------------------------------
    df["confidence_stars"] = df["minutes_played"].apply(confidence_stars)

    # ---- 5. archetype + strengths/areas ---------------------------------
    df["archetype"] = df.apply(assign_archetype, axis=1)
    strengths, improves = [], []
    for _, r in df.iterrows():
        labels = GK_ATTR_LABELS if r.position_code == "GK" else ATTR_LABELS
        s = [labels[a] for a in ATTRIBUTES
             if r[f"{a}_score"] >= 75 and not r.get(f"{a}_insufficient", False)]
        i = [labels[a] for a in ATTRIBUTES
             if r[f"{a}_score"] < 40 and not r.get(f"{a}_insufficient", False)]
        strengths.append(s)
        improves.append(i)
    df["strengths"] = strengths
    df["improvements"] = improves

    return df


# FIFA-shaped mapping: global percentile of the honest blend -> display rating.
# Anchors chosen so the median pro sits ~73, top ~5% are 86+, top ~1% are 90+,
# and the single best player approaches 99.
_FIFA_P = [0.00, 0.05, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99, 0.999, 1.00]
_FIFA_R = [52,   60,   67,   73,   79,   84,   87,   91,   95,    99]


def fifa_scale(overall_raw: pd.Series) -> pd.Series:
    """Re-percentile the honest Overall onto a FIFA-like 1-99 curve (global)."""
    pct = overall_raw.rank(pct=True)
    return np.interp(pct, _FIFA_P, _FIFA_R).round().clip(40, 99).astype(int)


def confidence_stars(minutes: float) -> int:
    if minutes >= 1800: return 5
    if minutes >= 900:  return 4
    if minutes >= 450:  return 3
    if minutes >= 180:  return 2
    if minutes >= 45:   return 1
    return 0


def assign_archetype(r: pd.Series) -> str:
    """Deterministic archetype from position + adjusted attribute scores (0-99
    scores ARE percentiles, so '>70' means 'above the 70th percentile')."""
    p = r["position_code"]
    PA, CR, FI, DE, WR = (r["passing_score"], r["creativity_score"],
                          r["finishing_score"], r["defending_score"], r["work_rate_score"])

    if p == "GK":
        if FI >= 75: return "Shot Stopper"            # SHOT STOPPING slot
        if CR >= 75: return "Sweeper Keeper"          # DISTRIBUTION slot
        if DE >= 75: return "Commanding Keeper"
        return "All-Round Keeper"

    if p == "DF":
        if PA >= 70 and DE >= 60: return "Ball-Playing Defender"
        if DE >= 70 and PA < 50:  return "Defensive Anchor"
        if WR >= 60 and DE >= 60:  return "Physical Defender"
        if PA >= 70:               return "Ball-Playing Defender"
        if DE >= 70:               return "Defensive Anchor"
        return "All-Round Defender"

    if p == "MD":
        if CR >= 70 and PA >= 60 and WR < 50: return "Deep Playmaker"
        if WR >= 70 and DE >= 60:             return "Box-to-Box"
        if CR >= 70:                          return "Creative Midfielder"
        if DE >= 70 and CR < 40:              return "Defensive Midfielder"
        if PA >= 70:                          return "Deep Playmaker"
        return "All-Round Midfielder"

    # FW
    spread = max(PA, CR, FI, DE, WR) - min(PA, CR, FI, DE, WR)
    if FI >= 70 and CR >= 70:        return "Complete Forward"
    if FI >= 70:                     return "Clinical Finisher"
    if CR >= 70:                     return "Creative Forward"
    if WR >= 65 and DE >= 55:        return "Pressing Forward"
    if spread <= 15:                 return "Complete Forward"
    return "All-Round Forward"


# ==========================================================================
# 8. COACH RATINGS  (matches + player_match_stats -> coach profiles)
# ==========================================================================
#
# A coach is identified by coachId and characterised by the TEAM-LEVEL play in
# the matches they managed. Coach NAMES are not in the dataset, so a coach is
# labelled by the team + competition they managed most.
#
# A coach card carries (mirroring the player card):
#   * a FIFA-shaped OVERALL (1-99) — a RESULTS-based quality signal (points &
#     goal difference per match), shrunk toward the mean for small samples so a
#     2-game cameo can't top the chart. Squad quality and coaching are
#     confounded in this data, so the Overall is explicitly a *results* number
#     shown WITH a confidence level, not a pure "coaching ability" score.
#   * a 6-dimension TACTICAL PROFILE (percentile among managers with enough
#     games) describing *style*, not quality: Attacking Intent, Possession,
#     Pressing, Defensive Solidity, Width, and Line Height.
#   * confidence stars from matches managed, a style archetype, and per-dim
#     explainability — exactly like the player card.

COACH_MIN_MATCHES_PROFILE = 15   # below this -> Overall + record only (e.g. national teams)
COACH_SHRINK_K = 6               # matches at which results are weighted 50/50 vs the mean


def _coach_team_match_signals() -> pd.DataFrame:
    """Per (match, team) event-derived tactical signals, read once from the
    enriched events:

      * press_actions — contesting actions (duels / recoveries) in the OPPONENT
        half (start_x > 55). A real high-press measure, unlike raw duel volume
        (which falls as possession rises).
      * def_line_x — the average x-position of a team's DEFENSIVE actions
        (clearances, defensive & aerial duels, recoveries). High = the team
        defends high up the pitch (aggressive line); low = a deep block.
    """
    parts = []
    for comp in COMPETITIONS:
        ev = pd.read_parquet(
            DATA / "events_enriched" / f"{comp}.parquet",
            columns=["match_id", "team_id", "start_x", "is_duel", "is_clearance",
                     "is_defensive_duel", "is_aerial_duel", "possession_retained"])
        press = (ev[((ev["is_duel"]) | (ev["possession_retained"])) & (ev["start_x"] > 55)]
                 .groupby(["match_id", "team_id"]).size().rename("press_actions"))
        defmask = (ev["is_clearance"] | ev["is_defensive_duel"]
                   | ev["is_aerial_duel"] | ev["possession_retained"])
        line = (ev[defmask].groupby(["match_id", "team_id"])["start_x"]
                  .mean().rename("def_line_x"))
        parts.append(pd.concat([press, line], axis=1).reset_index())
    return pd.concat(parts, ignore_index=True)


def build_coach_stats(pms: pd.DataFrame, matches: pd.DataFrame,
                      teams: pd.DataFrame) -> pd.DataFrame:
    """One row per coachId: record, a FIFA-shaped results Overall, confidence,
    and a 6-dim tactical profile."""
    # team-level aggregates per match (sum the players' stats by team)
    tm = pms.groupby(["match_id", "team_id"]).agg(
        passes=("pass_total", "sum"),
        passes_acc=("pass_accurate", "sum"),
        shots=("shots_total", "sum"),
        duels=("duels_total", "sum"),
        recoveries=("possession_retained", "sum"),
        clearances=("clearances", "sum"),
        crosses=("crosses", "sum"),
    ).reset_index()
    # possession proxy: this team's share of all passes played in the match
    tm["poss_share"] = tm["passes"] / tm.groupby("match_id")["passes"].transform("sum")
    tm = tm.merge(_coach_team_match_signals(), on=["match_id", "team_id"], how="left")
    tm["press_actions"] = tm["press_actions"].fillna(0)

    # explode matches into two coach rows (home, away) with result + GF/GA
    rows = []
    for m in matches.itertuples():
        for side, tid, cid, gf, ga in (
            ("home", m.home_team_id, m.home_coach_id, m.home_score, m.away_score),
            ("away", m.away_team_id, m.away_coach_id, m.away_score, m.home_score),
        ):
            if cid is None or pd.isna(cid):       # 237 missing -> excluded
                continue
            rows.append({"coach_id": int(cid), "match_id": m.match_id,
                         "team_id": tid, "competition_id": m.competition_id,
                         "gf": gf, "ga": ga,
                         "win": int(gf > ga), "draw": int(gf == ga), "loss": int(gf < ga)})
    cm = pd.DataFrame(rows).merge(tm, on=["match_id", "team_id"], how="left")

    agg = cm.groupby("coach_id").agg(
        matches=("match_id", "nunique"),
        wins=("win", "sum"), draws=("draw", "sum"), losses=("loss", "sum"),
        gf=("gf", "sum"), ga=("ga", "sum"),
        passes=("passes", "mean"), passes_acc=("passes_acc", "mean"),
        shots=("shots", "mean"), duels=("duels", "mean"),
        recoveries=("recoveries", "mean"), clearances=("clearances", "mean"),
        crosses=("crosses", "mean"), poss_share=("poss_share", "mean"),
        press_actions=("press_actions", "mean"), def_line_x=("def_line_x", "mean"),
    ).reset_index()

    # primary team + competition (the team a coach managed most)
    primary = (cm.groupby(["coach_id", "team_id", "competition_id"]).size()
                 .reset_index(name="n").sort_values("n", ascending=False)
                 .drop_duplicates("coach_id"))
    agg = agg.merge(primary[["coach_id", "team_id", "competition_id"]], on="coach_id")
    agg = agg.merge(teams[["team_id", "team_name"]], on="team_id", how="left")

    agg["goals_per_match"] = agg["gf"] / agg["matches"]
    agg["conceded_per_match"] = agg["ga"] / agg["matches"]
    agg["goal_diff_per_match"] = (agg["gf"] - agg["ga"]) / agg["matches"]
    agg["pass_completion"] = _safe_ratio(agg["passes_acc"], agg["passes"])
    agg["points_per_match"] = (3 * agg["wins"] + agg["draws"]) / agg["matches"]

    # ---- tactical profile (style, not quality) — managers with enough games --
    pool = agg["matches"] >= COACH_MIN_MATCHES_PROFILE
    agg["has_profile"] = pool

    def pct(col, mask, invert=False):
        s = agg.loc[mask, col]
        s = -s if invert else s
        r = s.rank(pct=True)
        out = pd.Series(np.nan, index=agg.index)
        out.loc[mask] = (r * 99).round().clip(1, 99)
        return out

    agg["attacking_intent"]   = pct("shots", pool)              # shots created
    agg["possession_control"] = pct("poss_share", pool)         # share of match passes
    agg["pressing_intensity"] = pct("press_actions", pool)      # defensive actions in opp half
    agg["defensive_solidity"] = pct("conceded_per_match", pool, invert=True)
    agg["width"]              = pct("crosses", pool)            # crossing / wing focus
    agg["line_height"]        = pct("def_line_x", pool)         # high line vs deep block

    agg["style"] = agg.apply(_coach_style, axis=1)

    # ---- results-based Overall (ALL coaches), Bayesian-shrunk then FIFA-scaled
    # Quality signal = points/match (primary) + goal difference/match. Small
    # samples are pulled toward the mean so a hot 2-game run can't top a season.
    w = agg["matches"] / (agg["matches"] + COACH_SHRINK_K)
    ppm_adj = w * agg["points_per_match"] + (1 - w) * agg["points_per_match"].mean()
    gd_adj  = w * agg["goal_diff_per_match"] + (1 - w) * agg["goal_diff_per_match"].mean()
    quality = 0.65 * ppm_adj.rank(pct=True) + 0.35 * gd_adj.rank(pct=True)
    agg["overall_raw"] = (quality * 99).round().astype(int)
    agg["overall"] = fifa_scale(quality)            # reuse the player FIFA curve
    agg["confidence_stars"] = agg["matches"].apply(coach_confidence_stars)
    return agg


def coach_confidence_stars(matches: int) -> int:
    """Coach sample-size confidence. A full league season is ~34-38 games; a
    deep cup run is ~7, so tournaments top out around 2★ — honestly thin."""
    if matches >= 34: return 5
    if matches >= 20: return 4
    if matches >= 10: return 3
    if matches >= 5:  return 2
    if matches >= 1:  return 1
    return 0


def _coach_style(r: pd.Series) -> str:
    if not r["has_profile"]:
        return "—"   # too few matches to characterise (e.g. national team)
    AT, PO, PR, DS, WI, LH = (
        r["attacking_intent"], r["possession_control"], r["pressing_intensity"],
        r["defensive_solidity"], r["width"], r["line_height"])
    # most specific styles first
    if PO >= 70 and PR >= 65 and LH >= 60:   return "Gegenpress"
    if PO >= 70 and AT >= 60:                return "Possession Master"
    if PR >= 70 and AT >= 55 and LH >= 55:   return "High-Press Architect"
    if LH <= 35 and DS >= 60 and PO < 55:    return "Deep Block"
    if WI >= 70 and AT >= 55:                return "Wing-Overload"
    if AT >= 70 and PO < 50:                 return "Direct / Counter-Attack"
    if DS >= 70:                             return "Defensive Organizer"
    if PO >= 65:                             return "Possession-Oriented"
    if PR >= 65 and LH >= 60:                return "Aggressive Press"
    return "Balanced Approach"


# ==========================================================================
# 9. EXPORT  (ratings + coaches -> ratings.json for the web app)
# ==========================================================================

COMP_LABELS = {c: f"{m['name']} {m['season']}" for c, m in COMPETITIONS.items()}

# headline raw stats surfaced on the card (career_column -> display key)
_CARD_RAW = {
    "goals": "goals", "assists": "assists", "shots_total": "shots",
    "goals_p90": "goals_p90", "key_passes_p90": "key_passes_p90",
    "pass_completion_pct": "pass_completion", "shot_accuracy_pct": "shot_accuracy",
    "clearances_p90": "clearances_p90", "aerial_duels_p90": "aerial_duels_p90",
    "save_pct": "save_pct", "clean_sheet_rate": "clean_sheet_rate",
    "header_goals": "header_goals",
}

# card stats that are true counts; everything else is a fraction/rate
_CARD_INT_KEYS = {"goals", "assists", "shots", "header_goals"}

# card stats that only make sense for goalkeepers
_CARD_GK_ONLY_KEYS = {"save_pct", "clean_sheet_rate"}


def _ordinal_pct(p: float) -> str:
    """0.97 -> 'Top 3%'."""
    top = round((1 - p) * 100)
    return "Top 1%" if top < 1 else f"Top {top}%"


def export_ratings_json(ratings: pd.DataFrame, coaches: pd.DataFrame,
                        out_path: Path | str) -> dict:
    """Assemble the full web-app payload and write it to out_path."""
    r = ratings.copy()
    pos_label = {"GK": "Goalkeeper", "DF": "Defender", "MD": "Midfielder", "FW": "Forward"}

    # per-attribute percentile within position (for explainability sentences)
    for a in ATTRIBUTES:
        r[f"{a}_pctile"] = r.groupby("position_code")[f"{a}_score"].rank(pct=True)

    players = []
    for row in r.itertuples():
        labels = GK_ATTR_LABELS if row.position_code == "GK" else ATTR_LABELS
        attrs, expl = {}, {}
        for a in ATTRIBUTES:
            score = int(getattr(row, f"{a}_score"))
            insto = bool(getattr(row, f"{a}_insufficient"))
            pctile = getattr(row, f"{a}_pctile")
            attrs[a] = {"score": score, "label": labels[a], "insufficient": insto}
            if not insto:
                expl[a] = (f"{score} — {_ordinal_pct(pctile)} among "
                           f"{pos_label[row.position_code]}s")

        # headline percentile (best non-insufficient attribute) for the share card
        best_a = max((a for a in ATTRIBUTES if not getattr(row, f"{a}_insufficient")),
                     key=lambda a: getattr(row, f"{a}_pctile"),
                     default=ATTRIBUTES[0])
        headline = (f"{_ordinal_pct(getattr(row, f'{best_a}_pctile'))} for "
                    f"{labels[best_a].title()} among {pos_label[row.position_code]}s")

        raw = {}
        for col, key in _CARD_RAW.items():
            if key in _CARD_GK_ONLY_KEYS and row.position_code != "GK":
                continue
            v = getattr(row, col, None)
            if v is not None and pd.notna(v):
                raw[key] = int(v) if key in _CARD_INT_KEYS else round(float(v), 3)

        players.append({
            "id": int(row.player_id),
            "name": row.short_name,
            "full_name": f"{row.first_name} {row.last_name}".strip(),
            "nationality": row.nationality,
            "position": row.position_code,
            "position_label": pos_label[row.position_code],
            "competitions": [COMP_LABELS[c] for c in row.competitions],
            "minutes": int(row.minutes_played),
            "matches": int(row.matches_played),
            "confidence_stars": int(row.confidence_stars),
            "overall": int(row.overall),
            "archetype": row.archetype,
            "attributes": attrs,
            "strengths": list(row.strengths),
            "improvements": list(row.improvements),
            "explainability": expl,
            "headline": headline,
            "raw_stats": raw,
        })
    players.sort(key=lambda p: -p["overall"])

    # coach tactical dimensions + display labels (mirrors the player attribute card)
    coach_dims = ["attacking_intent", "possession_control", "pressing_intensity",
                  "defensive_solidity", "width", "line_height"]
    coach_dim_labels = {
        "attacking_intent": "Attacking Intent", "possession_control": "Possession",
        "pressing_intensity": "Pressing", "defensive_solidity": "Defensive Solidity",
        "width": "Width", "line_height": "Line Height",
    }
    # per-dim percentile among profiled coaches (for explainability sentences)
    cf = coaches[coaches.has_profile].copy()
    for d in coach_dims:
        cf[f"{d}_pctile"] = cf[d].rank(pct=True)
    pctile_lookup = {int(r.coach_id): {d: getattr(r, f"{d}_pctile") for d in coach_dims}
                     for r in cf.itertuples()}

    coach_list = []
    for c in coaches.itertuples():
        entry = {
            "id": int(c.coach_id),
            "team": c.team_name,
            "competition": COMP_LABELS[c.competition_id],
            "matches": int(c.matches),
            "overall": int(c.overall),
            "confidence_stars": int(c.confidence_stars),
            "record": {"W": int(c.wins), "D": int(c.draws), "L": int(c.losses)},
            "goals_for": int(c.gf), "goals_against": int(c.ga),
            "points_per_match": round(float(c.points_per_match), 2),
            "goal_diff_per_match": round(float(c.goal_diff_per_match), 2),
            "has_profile": bool(c.has_profile),
            "style": c.style,
        }
        if c.has_profile:
            entry["profile"] = {d: int(getattr(c, d)) for d in coach_dims}
            pl = pctile_lookup.get(int(c.coach_id), {})
            entry["explainability"] = {
                d: f"{int(getattr(c, d))} — {_ordinal_pct(pl[d])} of managers"
                for d in coach_dims if d in pl and pd.notna(pl[d])}
            entry["strengths"] = [coach_dim_labels[d] for d in coach_dims
                                  if int(getattr(c, d)) >= 75]
            entry["headline"] = f"{c.style} · {round(float(c.points_per_match), 2)} pts/match"
        else:
            entry["headline"] = (f"{int(c.wins)}W–{int(c.draws)}D–{int(c.losses)}L · "
                                 f"{round(float(c.points_per_match), 2)} pts/match")
        coach_list.append(entry)
    coach_list.sort(key=lambda c: -c["overall"])

    payload = {
        "meta": {
            "n_players": len(players), "n_coaches": len(coach_list),
            "competitions": list(COMP_LABELS.values()),
            "attributes": ATTRIBUTES,
        },
        "players": players,
        "coaches": coach_list,
    }
    Path(out_path).write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    return payload
