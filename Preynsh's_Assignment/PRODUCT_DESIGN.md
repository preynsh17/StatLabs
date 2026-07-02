# PlayerNation Ratings Engine — Product Design (Final MVP)

**Version:** Final MVP  
**Dataset:** Full Wyscout dataset — 7 competitions, 1,941 matches, 3,251,294 events, 3,036 players.

---

## The Product

A **Football Identity Card** for every player and coach.

It answers one question: **Who are you as a footballer?**  
Not: "Here are your statistics."

The dataset is the demonstration. The framework is competition-agnostic — plug in any Wyscout-format data and it works.

---

## Full Dataset Scope

| Competition | Matches | Season | Events |
|---|---|---|---|
| English Premier League | 380 | 2017/18 | 643,150 |
| French Ligue 1 | 380 | 2017/18 | 632,807 |
| Italian Serie A | 380 | 2017/18 | 647,372 |
| Spanish La Liga | 380 | 2017/18 | 628,659 |
| German Bundesliga | 306 | 2017/18 | 519,407 |
| UEFA Euro 2016 | 51 | 2016 | 78,140 |
| FIFA World Cup 2018 | 64 | 2018 | 101,759 |
| **Total** | **1,941** | — | **3,251,294** |

**3,036 unique players. 526 players appear in 2+ competitions. 211 unique coach IDs.**

---

## Player Card — Final Structure

One card per player. All available data contributes. More data = higher confidence.

```
┌──────────────────────────────────────────┐
│  87    FW                    🇫🇷          │
│  Antoine Griezmann                        │
│  Atlético Madrid  ·  France              │
│                                           │
│  ◆  CREATIVE FORWARD                     │
│                                           │
│  PASSING      ██████████████  84         │
│  CREATIVITY   ████████████████ 92  ★     │  ← top attribute
│  FINISHING    ████████████    80         │
│  DEFENDING    █████            51         │
│  WORK RATE    ██████████████  79         │
│                                           │
│  Strengths                                │
│  ✓ Elite Chance Creation                  │
│  ✓ Progressive Play                       │
│  ✓ Final Third Impact                     │
│                                           │
│  Areas to Improve                         │
│  • Defensive Contribution                 │
│  • Aerial Presence                        │
│                                           │
│  ★★★★★  Proven Rating                    │
│  La Liga 17/18 + World Cup 2018           │
│  Top 8% among Forwards                   │
└──────────────────────────────────────────┘
```

**Strengths** = attributes ranked above the 75th percentile among position peers.  
**Areas to Improve** = attributes ranked below the 40th percentile among position peers.  
If no attribute is below the 40th percentile, the section is omitted (no false negatives).

---

## Attribute Set (Final — 5 Attributes)

### Confirmed Tag Decode (Audited)

| Tag | Verified Meaning |
|---|---|
| 1801 | Technically accurate action (NOT duel winner — see DEFENDING note) |
| 1802 | Technically inaccurate action |
| 101 | Goal scored — appears on BOTH Shot events AND Free Kick/Penalty events |
| 402 | Shot on target (goalkeeper save) |
| 302 | Pass directly preceding a shot |
| 1401 | Defensive action that retained possession |

**Critical: Goals must be counted from both `Shot` and `Free Kick` events with tag 101, excluding period `P` (penalty shootout). Harry Kane shows 3/6 goals from Shot events only — the other 3 were penalties under Free Kick events.**

---

### 1. PASSING — ✅ HIGH CONFIDENCE

**What it measures:** Execution quality and decision-making in possession.

**Sub-metrics:**
- Pass completion % (tag 1801 / total passes) — robust over a league season
- Progressive pass rate — passes where end_x > start_x + 10 (team-relative coordinates confirmed)
- Final third entry rate — passes where end_x > 66
- Pass type variety — simple, smart, high, head, cross, launch (subEventName)

**Position normalization:** Required. A CB completing 88% of backward passes vs a FW completing 78% of forward passes — position-group percentile resolves this.

---

### 2. CREATIVITY — ✅ HIGH CONFIDENCE

**What it measures:** How often a player creates dangerous situations.

**Sub-metrics:**
- Final third passes per 90
- Passes into the penalty area per 90 (x > 83, 21 < y < 79)
- Smart passes per 90 (subEventName = "Smart pass")
- Shot-preceding passes per 90 (tag 302) — now reliable across full dataset (~3,000+ events)

**Note:** Key passes (tag 302) were too sparse in WC-only data (437 total). Full dataset makes them a primary signal.

---

### 3. FINISHING — ✅ HIGH CONFIDENCE (upgraded with full dataset)

**What it measures:** Goal-scoring effectiveness and attacking threat.

**Sub-metrics:**
- Goals per 90 — from Shot events AND Free Kick events with tag 101, excluding period P
- Shot accuracy % (goals + saved shots) / total shots — reliable with league data (median FW: 27 shots per season in PL)
- Shots per 90 — attacking intent / volume
- Average shot distance (sqrt((100 - start_x)² + (50 - start_y)²)) — quality of positions reached

**GK override:** FINISHING → SHOT STOPPING  
- Saves per 90 (eventName = "Save attempt")
- Save percentage — saves / (saves + goals conceded)
- Reflexes per 90 (subEventName = "Reflexes")

---

### 4. DEFENDING — ✅ MEDIUM–HIGH CONFIDENCE (methodology revised)

**What it measures:** Defensive engagement and effectiveness.

**Critical finding from data audit:** Tag 1801 on duel events does NOT mean "duel won." In consecutive duel events at the same timestamp, both players frequently have tag 1801. The 61% "win rate" reflects technical execution quality, not contest outcomes. Duel win % is removed from DEFENDING.

**Revised sub-metrics:**
- Clearances per 90 (with 1801 = executed accurately)
- Clearance accuracy % (tag 1801 / total clearances)
- Ground defending duels per 90 (volume = defensive engagement)
- Aerial duel volume per 90 (subEventName = "Air duel") — presence in aerial contests
- Tag 1401 (possession retained after defensive action) per 90
- Fouls per 90 (inverted — disciplinary signal)

**Position normalization:** Essential. A CDM defending 8 duels per 90 is very different from a FW defending 2.

---

### 5. WORK RATE — ⚠️ MEDIUM CONFIDENCE

**What it measures:** Physical presence and involvement in the match.

**Sub-metrics:**
- Events per 90 — total involvement / work rate proxy
- Duels entered per 90 — physical engagement (regardless of outcome)

**Honest limitation:** Events per 90 measures involvement, not physical output. Off-ball running is invisible to this dataset. Position-normalization required — a CAM naturally has more events than a GK.

---

### GK Attribute Overrides

| Standard Attribute | GK Version | Signals |
|---|---|---|
| CREATIVITY | DISTRIBUTION | Goal kick accuracy (tag 1801), pass completion %, launch accuracy |
| FINISHING | SHOT STOPPING | Save %, saves per 90, reflexes per 90 |

PASSING, DEFENDING, WORK RATE remain — GKs distribute, contest aerials, and have measurable workload.

---

## Archetype System (16 Types, Rule-Based)

Generated deterministically from position-normalized attribute scores. No LLMs.

**Assignment logic:**
1. Compute 5 dimension percentile scores within position group
2. Find dominant dimension(s) — score > 70th percentile
3. Apply lookup table
4. Default: "All-Round [Position]" if no dominant dimension

**Goalkeepers:**
| Archetype | Trigger |
|---|---|
| Shot Stopper | SHOT STOPPING > 75th pct |
| Sweeper Keeper | DISTRIBUTION > 75th pct |
| Aerial Commander | Aerial duel volume > 75th pct |
| All-Round Keeper | No dominant dimension |

**Defenders:**
| Archetype | Trigger |
|---|---|
| Ball-Playing Defender | PASSING > 70th pct among DFs |
| Defensive Anchor | DEFENDING > 70th pct, PASSING < 50th pct |
| Physical Defender | WORK RATE + DEFENDING both > 60th pct |
| Composed Defender | PASSING + DEFENDING both > 60th pct |

**Midfielders:**
| Archetype | Trigger |
|---|---|
| Deep Playmaker | PASSING dominant, CREATIVITY high, WORK RATE < 50th pct |
| Box-to-Box | WORK RATE > 70th pct, DEFENDING > 60th pct |
| Creative Midfielder | CREATIVITY dominant (> 70th pct) |
| Defensive Midfielder | DEFENDING dominant, CREATIVITY < 40th pct |

**Forwards:**
| Archetype | Trigger |
|---|---|
| Clinical Finisher | FINISHING > 70th pct |
| Creative Forward | CREATIVITY > 70th pct |
| Target Forward | Aerial volume > 65th pct, WORK RATE > 60th pct |
| Complete Forward | All 5 within 15 points of each other |

---

## Confidence System

**Bayesian shrinkage — confidence affects the actual displayed rating.**

```
weight   = minutes_played / (minutes_played + 180)
adjusted = weight × raw_score + (1 − weight) × position_mean_score
```

| Stars | Minutes | Label | Context |
|---|---|---|---|
| ★★★★★ | ≥ 1,800 | Proven Rating | 20+ matches |
| ★★★★☆ | 900–1,799 | Established | ~10–20 matches |
| ★★★☆☆ | 450–899 | Growing Sample | ~5–10 matches |
| ★★☆☆☆ | 180–449 | Emerging Rating | ~2–5 matches |
| ★☆☆☆☆ | 45–179 | Limited Data | < 2 matches |
| — | < 45 | Not Rated | Excluded |

**Per-attribute handling:** If a player has zero events for an attribute (e.g., a DF with 0 shots), that attribute shows "—" — not 0, which would falsely penalize them.

---

## Overall Rating Calculation

Position-weighted composite of 5 attribute percentile scores, Bayesian-adjusted.

| Position | PASSING | CREATIVITY | FINISHING | DEFENDING | WORK RATE |
|---|---|---|---|---|---|
| GK | 20% | 20% (DIST) | 30% (STOP) | 20% | 10% |
| DF | 25% | 15% | 5% | 35% | 20% |
| MD | 25% | 25% | 10% | 20% | 20% |
| FW | 20% | 25% | 35% | 5% | 15% |

Scaled to 0–99 range using: `floor(percentile × 0.99 × 99)`

---

## Form Trend

| Feature | When Shown | Reliability |
|---|---|---|
| Per-match sparkline | 3+ appearances | Honest visualization |
| Trajectory arrow ↑/↓/→ | 10+ appearances | Defensible signal |
| "Peak Match" label | All players | Always valid |
| "Best Stretch" (5-game rolling) | 10+ appearances | Engaging, robust |

**Form is labeled "Season Form" for league players and "Tournament Form" for WC/Euro-only players.**  
No multi-year career trend language — this dataset covers one season per league.

---

## Share Card

Three elements only:

1. **Overall + Position** — "87 FW" — the hook
2. **Archetype** — "CREATIVE FORWARD" — the identity, the viral element
3. **Top Percentile** — "Top 5% for Creativity among Forwards" — the brag

Optional 4th: season achievement ("18G 12A · La Liga 17/18").

No confidence stars. No low attribute scores. No raw percentages.

---

## Competition Handling

**One card. One rating. One archetype.**

All available data contributes to a single unified rating. A player appearing in La Liga AND the World Cup has all their events aggregated before computing attributes. More competitions = more data = higher confidence stars.

No separate per-competition ratings are shown on the card.

The competition(s) that contributed to the rating appear as small text below the confidence stars: "La Liga 17/18 · World Cup 2018"

---

## Coach Cards

**No Overall Rating score.** The data does not support one — coaching quality and player quality are deeply confounded in 3–64 matches of data.

**League Manager Card (38 games — defensible):**
```
Pep Guardiola
Manchester City · Premier League 17/18
W25 D5 L8

TACTICAL PROFILE
Attacking Intent    ████████████████  Elite
Possession Style    ████████████████  Dominant
Pressing Intensity  ████████████      High
Defensive Solidity  ████████████      High

Style: Possession Master

⚠️ These are team-level metrics. They reflect squad quality
    as well as coaching decisions.
```

**National Team Coach Card (3–7 games — thin):**
```
Didier Deschamps
France · World Cup 2018
W6 D1 L0 — Winner 🏆
GF: 14  GA: 6
```

No tactical profile for national coaches — 3–7 matches is insufficient to characterize style.

**Coach Tactical Identity Labels:**
- Possession Master
- High Press Architect
- Counter Attack Specialist
- Defensive Organizer
- Direct Play Manager
- Balanced Approach

---

## Web Application Structure

```
Player Search
→ Identity Card (full card + confidence + archetype)
→ Explainability ("CREATIVITY: 92 — Top 8% among Forwards")
→ Form Chart (if 3+ matches)
→ Strengths & Areas to Improve
→ Share Card

Coach Section
→ League Coach Cards (tactical profile)
→ National Team Coach Cards (record only)
```

Nothing more. No tournament dashboards. No analytics-heavy pages. No competition-specific views.

---

## Explainability Format

Per attribute:
```
CREATIVITY: 92
Top 8% among Forwards (2.4 final third passes per 90, 1.1 key passes per 90)
```

Per archetype:
```
◆ CREATIVE FORWARD
You combine high chance creation with sharp final third movement,
ranking in the top tier for creativity among Forwards in this dataset.
```

Plain English. Grounded in specific metrics. No jargon.

---

## Known Limitations

1. **DEFENDING uses engagement volume, not win rates** — duel win tags are unreliable (both players in a contest often receive the accurate tag). This is disclosed in the methodology.
2. **Work Rate measures involvement, not physical output** — GPS/tracking data would be required for true work rate.
3. **Coach ratings are team-level proxies** — confounded by player quality. Explicitly acknowledged.
4. **Euro 2016 is from a different era** — cross-era comparison with 2017/18 league data has caveats.
5. **Sub-position resolution** — Wyscout only provides GK/DF/MD/FW. CDM vs CAM, winger vs striker — not distinguished.
6. **1-season snapshot** — ratings stabilize with multiple seasons of data.

---

## Evolution Roadmap

| Phase | Addition | Impact |
|---|---|---|
| V1 (now) | Event-based, 7 competitions | Framework ships |
| V2 | Multi-season rolling ratings | Form becomes a 12-month signal |
| V3 | xG model from shot coordinates | FINISHING becomes distance/angle-adjusted |
| V4 | Tracking data | Pace, press resistance, off-ball movement |
| V5 | Opponent strength adjustment | Context-aware ratings across divisions |
| V6 | Sub-position detection | CDM/CM/CAM/SS/CF archetypes |
