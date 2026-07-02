# PlayerNation Ratings Engine — Data Engineering & Validation Plan

**Purpose:** Blueprint for transforming raw Wyscout files into final ratings.json.  
**Do NOT implement until this document is approved.**

---

## Answer to Question 1: What's the Right Next Step?

**The correct sequence is: Master Tables → Feature Engineering → Validation → Ratings.**

The Dataset Audit is already done (confirmed tag meanings, event types, coordinate system, known issues). The next logical step is **building the master tables** — not writing rating formulas.

**Why master tables first:**

1. **Everything downstream depends on correct minutes played.** Per-90 normalization is applied to every single metric. If minutes are wrong (negative subs, ET miscalculation), every attribute score is corrupted. Build and validate minutes first, before any formula.

2. **Goal counting requires a multi-source join.** Kane's goals come from both `Shot` events AND `Free Kick/Penalty` events with tag 101. You cannot compute "total goals" without the `player_match_stats` table that aggregates both sources per player per match.

3. **Tag 1801 on duels is not duel "win."** DEFENDING uses clearances and defensive engagement volume, not duel win rates. The sub-metric selection for DEFENDING was revised post-audit — you need clean data before building that formula.

4. **Validation requires the tables.** Spot-checking "does De Bruyne rank in the top 5% for creativity?" requires a complete player_career_stats table. You can't validate formulas without the data they run on.

---

## Answer to Question 2: Data Engineering Roadmap

### Phase 0 — Locked Pre-Processing Decisions (from Audit)

These facts are confirmed and must be respected in all downstream phases:

| Discovery | Implementation Rule |
|---|---|
| Goals in both Shot AND Free Kick events | Count tag 101 from Shot + Free Kick, exclude period "P" |
| Tag 1801 on duels ≠ duel won | DEFENDING uses volume metrics, not win rates |
| Coordinates are team-relative | Progressive pass = end_x > start_x + 10 (universal for all teams) |
| Shot distance | sqrt((100 − start_x)² + (50 − start_y)²) |
| 237 team-match entries missing coachId | Attribute these matches to "Unknown Coach" — exclude from coach ratings |
| Penalty shootout goals | Tag 101 in period "P" → NOT a competitive goal |
| Subs up to minute 119 | Handle extra time by capping at 120 min, not 90 |

---

### Phase 1 — Dataset Audit ✅ COMPLETE

**Status:** Done. Key decisions locked above.

---

### Phase 2 — Data Loading and Cleaning

**Inputs:**
- `raw_data/players.json`
- `raw_data/teams.json`
- `raw_data/matches.zip` (7 files)
- `raw_data/events.zip` (7 files, ~956 MB)
- `processed/README.md` (match ID index)

**Outputs:**
- `players_master` DataFrame
- `teams_master` DataFrame
- `competitions_master` DataFrame
- `matches_master` DataFrame
- `player_appearances` DataFrame
- `events_raw` — one clean events DataFrame per competition (loaded per-competition to manage memory)

**Deliverables:** Python module `loader.py`

**Cleaning tasks:**
- Remove events where `playerId = 0` (system/unknown player events if any)
- Normalise `eventName` and `subEventName` to lowercase + stripped strings
- Parse `dateutc` timestamps from match metadata
- Flag matches with extra time: `has_extra_time = any(period in ("ET1", "ET2") for events in match)`
- Flag penalty shootouts: `has_penalties = any(period == "P" for events in match)`
- Compute `winner_team_id` from match scores (None if draw)

**Minutes Calculation (player_appearances):**
```
For each player in lineup:
  sub_out = substitutions where playerOut == player_id → first occurrence
  if sub_out exists:
    minutes = sub_out['minute']  
  elif match has extra time and player not subbed:
    minutes = 120
  else:
    minutes = 90

For each player in bench:
  sub_in = substitutions where playerIn == player_id → first occurrence
  if sub_in exists:
    max_minutes = 120 if has_extra_time else 90
    minutes = max_minutes - sub_in['minute']
  else:
    minutes = 0
```

**Edge cases to handle:**
- Red cards: player subbed off in match data has minute. Use as sub_off minute.
- Substitute for injured player in ET: minute may be > 90
- Negative result possible if minute > 90 on a regular time match — clamp to max 0.

**Validation checks for Phase 2:**
- `assert players_master['player_id'].is_unique`
- `assert player_appearances['minutes_played'].between(0, 120).all()`
- `assert player_appearances.groupby('player_id')['minutes_played'].sum().max() <= 1260` (7 × 120 worst case per competition × 7 comps... actually up to 840 if 7 WC games all with ET)
- Cross-check total match minutes per competition: 380 PL games × 90 min × 2 teams = 68,400 player-minutes — verify order of magnitude

**Risks:**
- hasFormation=0 cases: 0% in this dataset (verified) — not a risk
- coachId=None: 237 cases — handled by "Unknown Coach" exclusion

---

### Phase 3 — Event Enrichment

**Inputs:** `events_raw` (per competition)

**Output:** `events_enriched` (per competition, same row count — only adds columns)

**New columns added to each event row:**

```python
# Outcome flags (from tags)
is_accurate         = 1801 in tag_ids
is_inaccurate       = 1802 in tag_ids
is_goal             = (101 in tag_ids) AND (match_period NOT IN ("P"))
is_on_target        = 101 in tag_ids OR 402 in tag_ids
is_key_pass         = 302 in tag_ids
is_corner           = 801 in tag_ids

# Spatial (using team-relative coordinate system confirmed by audit)
progression_delta   = end_x - start_x                    # passes only; > 0 = forward
is_progressive_pass = (event_name == "Pass") AND (end_x > start_x + 10)
is_final_third_pass = (event_name == "Pass") AND (end_x > 66)
is_into_box_pass    = (event_name == "Pass") AND (end_x > 83) AND (21 < end_y < 79)
shot_goal_distance  = sqrt((100 - start_x)**2 + (50 - start_y)**2)  # shots only

# Classification helpers
is_defensive_duel   = sub_event_name == "Ground defending duel"
is_aerial_duel      = sub_event_name == "Air duel"
is_clearance        = sub_event_name == "Clearance"
is_penalty          = sub_event_name == "Penalty"
is_acceleration     = sub_event_name == "Acceleration"
is_smart_pass       = sub_event_name == "Smart pass"
is_cross            = sub_event_name in ("Cross", "Free kick cross")
```

**Deliverables:** Python module `enricher.py`

**Validation checks for Phase 3:**
- `assert events_enriched['is_goal'].sum() > 0`
- Check total goals: WC should have ~169 (64 games × ~2.64 avg goals); PL ~1024 (380 × 2.7 avg)
- `assert (events_enriched['is_progressive_pass'] & ~(events_enriched['event_name'] == 'Pass')).sum() == 0` — only passes can be progressive

---

### Phase 4 — player_match_stats

**Inputs:** `events_enriched` + `player_appearances`

**Output:** `player_match_stats` DataFrame  
**One row per (player_id, match_id) — the ATOMIC unit of the ratings pipeline.**

**Schema:**

| Column | Type | Definition |
|---|---|---|
| player_id | int | Wyscout player ID |
| match_id | int | Wyscout match ID |
| competition_id | str | e.g., "england", "world_cup" |
| team_id | int | Team in this match |
| minutes_played | float | From player_appearances |
| — **Passing** — | | |
| pass_total | int | eventName == "Pass" |
| pass_accurate | int | Pass AND is_accurate |
| pass_completion_pct | float | pass_accurate / pass_total (null if 0 passes) |
| progressive_passes | int | is_progressive_pass |
| final_third_passes | int | is_final_third_pass |
| into_box_passes | int | is_into_box_pass |
| smart_passes | int | is_smart_pass |
| crosses | int | is_cross |
| crosses_accurate | int | is_cross AND is_accurate |
| key_passes | int | is_key_pass (tag 302) |
| — **Shooting** — | | |
| shots_total | int | eventName == "Shot" |
| goals | int | is_goal (Shot OR Free Kick, not period P) |
| shots_on_target | int | is_on_target on Shot events |
| shot_distance_avg | float | avg shot_goal_distance for shots taken |
| penalties_taken | int | is_penalty |
| — **Duels** — | | |
| duels_total | int | eventName == "Duel" |
| defensive_duels | int | is_defensive_duel |
| aerial_duels | int | is_aerial_duel |
| ground_attacking_duels | int | subEventName == "Ground attacking duel" |
| — **Defensive** — | | |
| clearances | int | is_clearance |
| clearances_accurate | int | is_clearance AND is_accurate |
| fouls_committed | int | eventName == "Foul" |
| defensive_actions_retaining | int | tag 1401 events |
| — **Ball carrying** — | | |
| accelerations | int | is_acceleration |
| touches | int | subEventName == "Touch" |
| total_events | int | All events (work rate proxy) |
| — **GK only** — | | |
| saves | int | eventName == "Save attempt" |
| reflexes | int | subEventName == "Reflexes" |
| goal_kicks | int | subEventName == "Goal kick" |
| goal_kicks_accurate | int | Goal kick AND is_accurate |
| — **From match metadata** — | | |
| yellow_cards | int | From player_appearances |
| red_cards | int | From player_appearances |

**Deliverables:** Python function `compute_player_match_stats()`

**Validation checks for Phase 4:**
- WC 2018 total goals from shots: ~145 (open play/penalty, not shootouts)
- WC 2018 total goals from free kicks: ~24
- Harry Kane WC goals (Shot + Free Kick, not period P): 6
- Thibaut Courtois WC saves: 35
- Each row must have `minutes_played > 0` (or be dropped)

---

### Phase 5 — player_career_stats

**Inputs:** `player_match_stats` + `players_master`

**Output:** `player_career_stats` DataFrame  
**One row per player — the PRIMARY INPUT for attribute calculation.**

**Construction:**
1. For each player, sum all counting stats across all matches across all competitions
2. Compute total `minutes_played` and `matches_played`
3. Compute per-90 values: `metric_p90 = (metric / minutes_played) * 90`
4. Compute rate values: completion %, clearance accuracy %, etc.
5. Record which `competition_ids` contributed to this player's data

**Per-90 metrics computed:**
- pass_total_p90, progressive_passes_p90, final_third_passes_p90, into_box_passes_p90
- smart_passes_p90, key_passes_p90, crosses_p90
- goals_p90, shots_p90, shots_on_target_p90
- clearances_p90, defensive_duels_p90, aerial_duels_p90
- accelerations_p90, total_events_p90 (work rate), defensive_actions_retaining_p90
- saves_p90, reflexes_p90 (GK only)

**Additional career-level stats:**
- competitions_list (array of competition_ids)
- n_competitions
- form_by_match: array of (match_id, date, per-match overall score) — populated in Phase 9

**Minimum threshold:** Players with < 45 total minutes across ALL competitions → `is_rated = False`.

**Validation checks for Phase 5:**
- Per-90 stats should be non-negative
- Pass completion distribution: GKs ~55-70%, DFs ~80-88%, MDs ~82-90%, FWs ~75-85%
- Goals per 90 for FWs: mean ~0.4-0.6; max should be ~1.5-2.0 (elite striker)

---

### Phase 6 — Feature Validation

**This phase exists to catch bugs before computing attributes. Stop if any check fails.**

See the Feature Validation Framework section below for the complete checklist.

---

### Phase 7 — Attribute Computation

**Inputs:** `player_career_stats` + position peer groups

**Output:** `player_attributes` DataFrame  
**One row per player. Five attribute scores (0-99) + per-attribute confidence flag.**

**Method for each attribute:**
1. For each sub-metric in the attribute, compute the **percentile rank within position group** (GK/DF/MD/FW)
2. Compute the weighted average of sub-metric percentiles = raw attribute score (0-100)
3. If player has zero events for an attribute's core metric → mark attribute as `insufficient_data = True`

**Sub-metric weights per attribute:**

*PASSING:*
- Pass completion % → 35%
- Progressive passes p90 → 30%
- Final third pass rate (final_third_passes / pass_total) → 20%
- Pass type richness (proportion of smart + head + cross vs total) → 15%

*CREATIVITY:*
- Final third passes p90 → 30%
- Into box passes p90 → 25%
- Smart passes p90 → 25%
- Key passes (tag 302) p90 → 20%

*FINISHING (outfield):*
- Goals p90 → 40%
- Shot accuracy % → 30%
- Shots on target p90 → 20%
- Inverted shot distance avg (closer = better) → 10%

*FINISHING (GK → SHOT STOPPING):*
- Save % → 50%
- Saves p90 → 30%
- Reflexes p90 → 20%

*DEFENDING:*
- Clearances p90 → 30%
- Clearance accuracy % → 20%
- Defensive actions retaining possession (1401) p90 → 20%
- Aerial duels p90 → 15%
- Defensive duels p90 → 15%

*WORK RATE:*
- Total events p90 → 60%
- Duels entered p90 → 40%

*CREATIVITY (GK → DISTRIBUTION):*
- Goal kick accuracy % → 40%
- Pass completion % → 40%
- Long ball (launch) accuracy % → 20%

**Deliverables:** Python function `compute_attributes()`

---

### Phase 8 — Confidence System

**Inputs:** `player_career_stats` (minutes_played), `player_attributes`

**Formulas:**
```python
K = 180  # calibrated to 2 matches worth of data as the inflection point

def bayesian_adjust(raw_score, minutes, position_mean):
    weight = minutes / (minutes + K)
    return weight * raw_score + (1 - weight) * position_mean

def confidence_stars(minutes):
    if minutes >= 1800: return 5
    if minutes >= 900:  return 4
    if minutes >= 450:  return 3
    if minutes >= 180:  return 2
    if minutes >= 45:   return 1
    return 0  # not rated
```

**Applied to:** Overall score + each individual attribute score.

---

### Phase 9 — Archetype Assignment

**Inputs:** Bayesian-adjusted attribute scores + position

**Method:** Deterministic rule table from PRODUCT_DESIGN.md.  
Always assigns an archetype. No player goes unlabelled.

---

### Phase 10 — Per-Match Form Rating

**Inputs:** `player_match_stats` per match

**Method:** Apply the same attribute formulas to each individual match's stats, compared to the tournament-level peer distribution. This gives each match a 0–99 score — these form the sparkline.

**Only stored for players with 3+ appearances (where a sparkline is meaningful).**

---

### Phase 11 — ratings.json Output

**Inputs:** All phases above

**Output:** `ratings.json` — the complete payload for the web app.

```json
{
  "generated_at": "...",
  "players": [
    {
      "id": 8717,
      "name": "Harry Kane",
      "short_name": "H. Kane",
      "nationality": "England",
      "position": "FW",
      "competitions": ["england", "world_cup"],
      "total_minutes": 2842,
      "matches_played": 38,
      "confidence_stars": 5,
      "overall": 89,
      "archetype": "Clinical Finisher",
      "attributes": {
        "passing": {"score": 72, "label": "PASSING", "insufficient": false},
        "creativity": {"score": 68, "label": "CREATIVITY", "insufficient": false},
        "finishing": {"score": 94, "label": "FINISHING", "insufficient": false},
        "defending": {"score": 55, "label": "DEFENDING", "insufficient": false},
        "work_rate": {"score": 81, "label": "WORK RATE", "insufficient": false}
      },
      "strengths": ["Elite Finishing", "High Shot Volume", "Box Presence"],
      "improvements": [],
      "explainability": {
        "finishing": "94 — Top 2% among Forwards. Driven by 0.84 goals per 90 and 73% shot accuracy across 38 apps.",
        "creativity": "68 — 42nd percentile among Forwards."
      },
      "form": {
        "matches": ["2057983", "2057995", ...],
        "labels": ["vs BEL", "vs TUN", ...],
        "scores": [82, 78, 91, ...]
      },
      "raw_stats": {
        "goals": 8,
        "shots": 42,
        "passes_p90": 24.1,
        "pass_completion_pct": 0.71,
        ...
      }
    }
  ],
  "coaches": [
    {
      "id": 25549,
      "name": "Didier Deschamps",
      "team": "France",
      "competitions": ["world_cup"],
      "record": {"W": 6, "D": 1, "L": 0},
      "stage_reached": "Winner",
      "style_label": "Possession Master",
      "team_metrics": {
        "attacking_intent": 78,
        "possession_style": 88,
        "pressing_intensity": 71,
        "defensive_solidity": 91
      }
    }
  ]
}
```

---

### Phase 12 — Web Application

**Inputs:** `ratings.json`  
**Output:** `index.html` (self-contained), `process.py` (runner)

**Deliverables structure:**
```
ratings_engine/
├── process.py       # Run this first
├── index.html       # Open in browser after running process.py
├── ratings.json     # Generated output (~2-5 MB)
├── METHODOLOGY.md   # Decision document
└── README.md        # How to run
```

---

## Answer to Question 3: Master Table Design

### Table 1: `players_master`
**Why:** Single source of truth for biographical metadata. Prevents duplication across competition event files.

```
player_id         INT    PK    Wyscout wyId (consistent across all competitions ✓)
first_name        TEXT
last_name         TEXT
short_name        TEXT         e.g., "H. Kane"
birth_date        DATE
nationality       TEXT         passportArea.name
position_code     TEXT         GK / DF / MD / FW
height_cm         INT
weight_kg         INT
preferred_foot    TEXT         left / right / null
```

**Source for ratings:** Biographical display on card. Position_code determines attribute weights and peer group.

---

### Table 2: `competitions_master`
**Why:** Competition metadata needed for display, confidence calculation context, and coach card labels.

```
competition_id    TEXT   PK    e.g., "england", "world_cup"
competition_name  TEXT         e.g., "English Premier League"
season            TEXT         e.g., "2017/18"
competition_type  TEXT         "league" or "tournament"
n_matches         INT
```

---

### Table 3: `matches_master`
**Why:** Match context for form labels, coach attribution, and ET/penalty detection.

```
match_id          INT    PK
competition_id    TEXT   FK → competitions_master
date_utc          TEXT
home_team_id      INT
away_team_id      INT
home_score        INT
away_score        INT
winner_team_id    INT    null if draw
has_extra_time    BOOL
has_penalties     BOOL
home_coach_id     INT    null if missing (237 cases)
away_coach_id     INT    null if missing
stage_label       TEXT   e.g., "Group A", "Quarter-Final", "Final"
```

---

### Table 4: `player_appearances`
**Why:** Minutes played is the denominator for every per-90 metric. This table must be correct before anything else.

```
player_id          INT    FK → players_master
match_id           INT    FK → matches_master
team_id            INT
competition_id     TEXT
started            BOOL
minutes_played     FLOAT  0–120, 0 if benched and not used
subbed_on_minute   INT    null if started or not used
subbed_off_minute  INT    null if played full game
yellow_cards       INT    from match formation data
red_cards          INT    from match formation data
```

---

### Table 5: `player_match_stats` ← PRIMARY ATOMIC TABLE
**Why:** Every rating, every form chart data point, every validation check runs from here. This is the single source of truth for player performance.

*(Full schema defined in Phase 4 above.)*

**Sources ratings:** Form sparkline (per-row = one match rating). Rollup into player_career_stats.

---

### Table 6: `player_career_stats` ← PRIMARY RATINGS INPUT
**Why:** This is what attribute formulas consume. One row per player, aggregated across all their competitions.

*(Columns = all player_match_stats columns summed/averaged + per-90 normalizations. Full definition in Phase 5.)*

---

### Table 7: `coach_match_stats`
**Why:** Enables coach tactical profile computation per coach per match.

```
coach_id                INT
match_id                INT    FK
team_id                 INT
competition_id          TEXT
result                  TEXT   "W" / "D" / "L"
goals_scored            INT    from match score
goals_conceded          INT    from match score
shots_created           INT    team's Shot events
passes_total            INT    team's Pass events
pass_completion_pct     FLOAT
duels_in_opp_half       INT    proxy for pressing
clearances              INT    team's Clearance events
```

---

### Table 8: `coach_career_stats` ← COACH RATINGS INPUT
**Why:** Aggregated tactical profile across all matches coached.

```
coach_id                INT    PK
team_id                 INT    most recent team
competition_ids         TEXT   comma-separated list
matches_coached         INT
wins, draws, losses     INT
goals_per_match         FLOAT
conceded_per_match      FLOAT
shots_per_match         FLOAT
pass_completion_avg     FLOAT
passes_per_match        FLOAT
duels_opp_half_pm       FLOAT
clearances_per_match    FLOAT
```

---

## Answer to Question 4: Feature Validation Framework

Three-level validation. **Fail on any Level 1 or Level 2 failure before proceeding to ratings.**

---

### Level 1 — Mathematical Validity (Automated, hard fail)

```python
# These must all pass before Phase 7
assert player_career_stats['pass_completion_pct'].between(0, 1).all()
assert player_career_stats['goals_p90'].ge(0).all()
assert player_career_stats['minutes_played'].gt(0).all()  # after filtering < 45 min
assert player_career_stats['shot_accuracy_pct'].between(0, 1).dropna().all()
# Duel symmetry check (at match level, not player level):
# Total duels in a match should be even-ish (each contest = 2 records)
```

---

### Level 2 — Distribution Sanity (Automated, hard fail)

```python
# Pass completion by position — known real-world ranges
gk_completion  = player_career_stats.loc[pos=='GK', 'pass_completion_pct']
df_completion  = player_career_stats.loc[pos=='DF', 'pass_completion_pct']
md_completion  = player_career_stats.loc[pos=='MD', 'pass_completion_pct']
fw_completion  = player_career_stats.loc[pos=='FW', 'pass_completion_pct']

assert gk_completion.median().between(0.55, 0.78), "GK pass completion out of range"
assert df_completion.median().between(0.78, 0.92), "DF pass completion out of range"
assert md_completion.median().between(0.80, 0.92), "MD pass completion out of range"
assert fw_completion.median().between(0.72, 0.88), "FW pass completion out of range"

# Goals per 90 for FWs
fw_goals_p90 = player_career_stats.loc[pos=='FW', 'goals_p90']
assert fw_goals_p90.mean().between(0.25, 0.65), "FW goals p90 distribution suspect"
assert fw_goals_p90.max() < 3.0, "FW max goals p90 suspiciously high — check minutes"

# Save % for GKs
gk_save_pct = player_career_stats.loc[pos=='GK', 'gk_save_pct']
assert gk_save_pct.mean().between(0.55, 0.80), "GK save % distribution suspect"
```

---

### Level 3 — Named Player Spot Checks (Manual Review, soft fail → investigate)

| Player | Competition | Metric | Expected | Tolerance |
|---|---|---|---|---|
| Harry Kane | World Cup 2018 | goals | 6 | exactly 6 |
| Thibaut Courtois | World Cup 2018 | saves | 35 | ± 2 |
| Harry Kane | Premier League 17/18 | goals | 30 | ± 3 |
| Mohamed Salah | Premier League 17/18 | goals | 32 | ± 3 |
| Kevin De Bruyne | Premier League 17/18 | CREATIVITY percentile (MD) | > 90th | — |
| Luka Modrić | World Cup 2018 | PASSING percentile (MD) | > 85th | — |
| Virgil van Dijk | Premier League 17/18 | DEFENDING percentile (DF) | > 80th | — |
| Lionel Messi | La Liga 17/18 | FINISHING percentile (FW) | > 90th | — |
| Cristiano Ronaldo | La Liga 17/18 | FINISHING percentile (FW) | > 90th | — |

**If any hard number check (goals, saves) is off by more than the tolerance: trace back through Phase 3 enrichment. The most likely cause is goal counting logic.**

---

### Level 4 — Cross-Competition Consistency (Manual review)

For players appearing in 2+ competitions, check that their attributes are plausible:
- A player who ranks 90th percentile in PASSING in the PL should rank within 25 percentile points in the WC (extreme drops suggest data quality issues, not just performance variation)
- If a player appears to have played 150 minutes per match, the minutes calculation has a bug

---

## Answer to Question 5: Risk Register

### CRITICAL — Could invalidate a whole attribute

**R1: Goals undercounted (CONFIRMED — mitigated)**  
- **Issue:** Harry Kane shows 3/6 WC goals from Shot events. 3 additional goals were in `Free Kick / Penalty` events with tag 101.  
- **Impact:** FINISHING attribute wrong for penalty takers. Kane's FINISHING would be 50% understated.  
- **Mitigation:** Phase 0 locked: count tag 101 from both Shot AND Free Kick events, exclude period P.  
- **Validation:** Level 3 Kane goal count must be exactly 6 WC.  
- **Residual Risk:** Low — explicitly handled.

**R2: Duel win rate unreliable (CONFIRMED — mitigated)**  
- **Issue:** Tag 1801 on duels reflects technical accuracy, not contest outcome. Both players in the same duel can have 1801. Verified: 61% of duels have 1801 (impossible if it meant "won").  
- **Impact:** Any DEFENDING metric using duel win % would be meaningless.  
- **Mitigation:** Phase 0 locked: DEFENDING uses volume metrics (clearances per 90, defensive duel volume, aerial duel volume), not win rates.  
- **Residual Risk:** Low — redesigned around confirmed signals.

---

### HIGH — Degrades specific attribute quality

**R3: Minutes calculation errors for extra time matches**  
- **Issue:** 31 substitutions occur after minute 90 in WC data (max sub minute = 119). If ET is not detected, these players are credited too few minutes.  
- **Impact:** Per-90 stats inflated for ET participants. Modric, Griezmann (long WC runs) have systematic minutes undercount if ET not handled.  
- **Mitigation:** Detect ET from event matchPeriod values. Cap at 120 min, not 90.  
- **Validation:** Level 1 — `minutes_played.max() <= 120`.

**R4: Sub-position ambiguity (unfixable)**  
- **Issue:** Wyscout only provides GK/DF/MD/FW. CDM vs CAM have completely different performance profiles but share the "MD" percentile group. A CDM with 45 defensive duels per 90 competes in percentile against a CAM with 8.  
- **Impact:** DEFENDING is inflated for CDMs (they compete against AMs who barely defend). CREATIVITY is inflated for AMs/wingers against CDMs.  
- **Mitigation:** None available in this dataset. Acknowledge in methodology. Future V2 fix.  
- **Residual Risk:** Medium — archetypes partially compensate (CDM → Defensive Midfielder archetype separates them).

**R5: Own goals misattributed**  
- **Issue:** Own goals appear as Shot events with tag 101 attributed to the defending player who accidentally put it in their own net. In the current formula, this credits them with a "goal."  
- **Impact:** Rare but real. Mats Hummels' WC 2018 own goal would inflate his FINISHING score incorrectly.  
- **Detection:** Cross-check `goals computed` vs `match score` per team — if goals > team_score, there's an attribution issue.  
- **Mitigation:** Identify own goals: Shot event with tag 101, where the shooter's team_id ≠ the "team scoring" implied by score change. Requires match-score attribution logic.  
- **Residual Risk:** Medium-low — affects a small number of players but is technically fixable.

**R6: 237 missing coach IDs**  
- **Issue:** 6.1% of team-match entries have no coachId.  
- **Impact:** Those matches are excluded from coach career stats. A coach who managed some of those matches appears to have coached fewer games.  
- **Mitigation:** Exclude from coach ratings only, not player ratings.  
- **Residual Risk:** Low for player ratings. Medium for coach ratings.

---

### MEDIUM — Manageable with data acknowledgment

**R7: Euro 2016 era mismatch**  
- **Issue:** Euro 2016 data is from 2016. League data is from 2017/18. WC 2018 is from 2018. Isco in La Liga 17/18 is different from Isco in Euro 2016 (2 years earlier).  
- **Impact:** Cross-era aggregation gives a slightly blurred "career snapshot," not a snapshot at one moment.  
- **Mitigation:** Label cards with specific competition list. Acknowledge in methodology as a limitation.  
- **Residual Risk:** Low — this is a reasonable trade-off for a demo dataset.

**R8: Coordinate system not independently verified for all competitions**  
- **Issue:** Coordinate system confirmed team-relative for WC 2018. Assumed to be the same for league data — standard Wyscout convention.  
- **Impact:** Progressive pass calculation wrong for leagues if convention differs.  
- **Validation:** In Phase 6, spot-check one league match: a team's shots should start from x > 70 (attacking third).  
- **Residual Risk:** Low — Wyscout uses consistent convention across products.

---

### LOW — Minor, cosmetic

**R9: Yellow card counts off-by-one in some matches**  
Yellow card data is pulled from match lineup/bench stats, which may have time encoding issues. Impact: Minimal (yellow cards are a minor input to fouls/discipline signals).

**R10: Accuracy of player nationality for dual-nationality players**  
Some players have passportArea ≠ national team they competed for. Impact: Card display only — flag shown may not match competition they played in.

---

## Summary Table

| Phase | Module | Primary Output | Estimated Rows |
|---|---|---|---|
| 2 | loader.py | players_master, matches_master, appearances | 3,036 / 1,941 / ~35,000 |
| 3 | enricher.py | events_enriched | 3,251,294 |
| 4 | aggregator.py | player_match_stats | ~100,000 |
| 5 | aggregator.py | player_career_stats | ~3,036 |
| 6 | validator.py | Validation report (pass/fail) | — |
| 7 | attributes.py | player_attributes | ~3,036 |
| 8 | confidence.py | player_ratings (adjusted) | ~3,036 |
| 9 | archetypes.py | player_archetypes | ~3,036 |
| 10 | forms.py | player_form_sparklines | ~variable |
| 11 | exporter.py | ratings.json | ~3,036 players + 211 coaches |
| 12 | — | index.html + process.py | — |
