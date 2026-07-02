# PlayerNation Ratings Engine — Methodology

*A football identity card for every player and coach, built from Wyscout event data.*

This document is about **decisions** — what the ratings represent, how they're
computed, the assumptions made, the trade-offs accepted, and how the system
would evolve. The working solution (notebooks + `process.py` + web app) is
described in `ratings_engine/README.md`.

---

## 1. Philosophy

The brief is not "build a stats table." It's: **who is this player?** So the
output is a **Football Identity Card** — a single Overall, five interpretable
attributes, an archetype label, a confidence level, and a plain-English reason
for every number. A rating that can't be explained isn't useful to a player
trying to improve.

Three principles drove every decision:

1. **Multi-dimensional, not one number.** A single score hides *why*. We give
   five attributes (PASSING, CREATIVITY, FINISHING, DEFENDING, WORK RATE) plus a
   blended Overall. A defender and a winger are different kinds of good.
2. **Position-fair.** Every metric is ranked *within a player's position group*.
   A centre-back is compared to centre-backs, never to forwards.
3. **Honest about confidence.** A great hour of football is not a great season.
   Ratings shrink toward the average when the sample is thin, and the card shows
   how much data backs each rating.

The dataset (7 competitions, 1,941 matches, **3.25M events**, 3,036 players) is
the *demonstration*. The framework is competition-agnostic: any Wyscout-format
feed plugs in.

---

## 2. What a rating represents

| Element | Meaning |
|---|---|
| **Overall (1–99)** | Position-weighted blend of the five attributes, on a FIFA-like scale. |
| **5 attributes (1–99)** | Each a weighted blend of sub-metrics, ranked within position. GKs swap CREATIVITY→DISTRIBUTION and FINISHING→SHOT STOPPING. |
| **Archetype** | A deterministic label (e.g. *Creative Midfielder*, *Ball-Playing Defender*) from the attribute profile. |
| **Confidence ★** | How much data backs the rating (minutes played). |
| **Strengths / Areas** | Attributes above the 75th / below the 40th percentile among peers. |
| **Explainability** | "CREATIVITY 96 — Top 1% among Midfielders," etc. |

---

## 3. Data foundations (decisions that had to be right first)

Before any rating, the features were validated against football ground truth.
Five data decisions materially changed the output:

1. **Goals are taken from the match sheet, not event tags.** Goal tag `101`
   also fires on *conceded* shots and on shootouts. The lineup `goals` field
   matched event-derived goals to **100.0 %** (5,049 vs 5,048) and reproduced
   Kane's 6 World Cup goals exactly. Own goals are excluded automatically (they
   are a separate field).
2. **Shot-on-target = tag `1801`** (every shot carries exactly one of
   1801/1802; every goal carries 1801). An earlier wrong tag had Messi at 24.7 %
   accuracy; fixing it moved his FINISHING from the 63rd to the 97th percentile.
3. **Assists are derived from events (tag `301`)** because the lineup `assists`
   field is empty for all five leagues.
4. **Minutes** come from lineups + substitution minutes, capped at 90 (120 for
   extra-time matches); red-card minutes trim playing time. All minutes land in
   [0, 120].
5. **Names are decoded** — the source double-escapes accents, so 899 players'
   names arrived as `Aréola`; these are repaired to `Aréola`.

The feature layer was then gated on six leaderboards (top finishers, creators,
passers, defenders, workhorses, keepers). Only after the right players appeared
(Messi/Ronaldo/Salah; De Bruyne/Özil; Oblak/Neuer; ball-playing CBs) was any
rating computed.

---

## 4. Rating logic

### 4.1 Position-normalised percentiles
Each sub-metric → **percentile rank within the player's GK/DF/MD/FW group**.
Rate metrics (accuracy %, save %) only count once a minimum volume is reached
(e.g. ≥ 5 shots) so "1 of 1 = 100 %" can't masquerade as elite.

### 4.2 Attribute blends
Each attribute is a weighted blend of its sub-metrics (full weights in
`RATING_DECISIONS.md`). Examples:
- **FINISHING** = 40 % goals/90 + 30 % shot accuracy + 20 % shots-on-target/90 + 10 % shot distance.
- **DEFENDING** = possession-adjusted clearances + clearance accuracy + recoveries + defensive duels + aerial duels + **header-goal threat** (set-piece scoring).
- **SHOT STOPPING (GK)** = 55 % save % + 20 % clean-sheet rate + saves/90 + reflexes.

### 4.3 The "too few games" problem — three layers
1. **Hard floor:** < 45 minutes → not rated (217 players excluded).
2. **Bayesian shrinkage:** every score is pulled toward the position mean with
   weight `minutes / (minutes + 180)`. At ~2 matches a player is weighted 50/50
   against the prior; by a full season they're ~95 % their own data. This is why
   a hot 100-minute cameo can't top the chart.
3. **Confidence stars** (45 / 180 / 450 / 900 / 1800 min) are shown so the user
   reads a number *and* its reliability.

### 4.4 Overall, on a FIFA-like scale
The Overall is a position-specific weighting of the five attributes (a
forward's FINISHING counts 35 %, a defender's DEFENDING 52 %). The raw blend is
statistically honest but compressed (best ≈ 83). To read like a real card, it is
**re-percentiled onto a FIFA-shaped curve**: median pro ≈ 73, top ~5 % at 86+,
the elite past 90, the very best near 99. The blend still does the *ranking*;
the curve only sets the *display scale*.

### 4.5 Archetypes
Deterministic rules on the attribute profile (no clustering — too few players
per position to fit it reliably). Every player gets a label; the fallback is
"All-Round [Position]."

---

## 5. Coaches

The dataset contains **no coach names** (only a `coachId` per team-match), so a
coach is labelled by the **team + competition** they managed most. The coach
card mirrors the player card — an Overall, a multi-dimensional profile, an
archetype, confidence, and explanations — with one honesty rule baked in.

**The Overall is a *results* number, not a *coaching-ability* number.** Coaching
quality and squad quality are inseparable in event data; we don't pretend
otherwise. The Overall blends **points per match (65 %)** and **goal difference
per match (35 %)**, Bayesian-shrunk toward the mean (`matches / (matches + 6)`)
so a hot 3-game cameo can't outrank a full season, then displayed on the **same
FIFA curve as players** (median ≈ 73, the elite past 90). **Confidence stars**
(from matches managed; a full league season = 5★, a deep cup run ≈ 2★) sit next
to it so the reader always sees how much data backs the number. This is the
explicit trade-off the brief invites: an engaging headline number, with its
confound and its sample size shown rather than hidden.

**Style is separate from quality** — a **6-dimension tactical profile**,
percentiled among managers with ≥ 15 games:

- **Attacking Intent** — shots created per match.
- **Possession** — the team's share of all passes in a match (a true share, not
  raw pass volume, so it isn't inflated by tempo or extra time).
- **Pressing** — contesting actions in the *opponent* half (a real high-press
  signal, not raw duel volume, which *falls* as possession rises).
- **Defensive Solidity** — goals conceded per match (inverted).
- **Width** — crosses per match (wing/crossing focus vs central play).
- **Line Height** — the average pitch x-position of the team's *defensive*
  actions (a high line / aggressive press vs a deep block).

These feed a richer archetype set (*Possession Master, Gegenpress, High-Press
Architect, Deep Block, Wing-Overload, Direct/Counter-Attack, Defensive
Organizer, …*). Managers with too few games (national teams, mid-season
replacements) keep the Overall + record but show no profile — a 7-game sample
can't be fairly percentiled against a 38-game season.

Sanity holds across the board: Guardiola's City = **Possession Master** and the
**99** Overall; Klopp's Liverpool and Pochettino's Spurs = **Gegenpress** (top
pressing + high line); Simeone's Atlético = **Defensive Organizer** (top
Defensive Solidity, deep line); Barça post the **lowest Width** in the data
(tiki-taka through the middle); Deschamps' World-Cup-winning France sits high on
Overall but at low confidence (record only).

---

## 6. Key trade-offs (made explicitly)

| Trade-off | Decision & why |
|---|---|
| **One score vs many** | Both — five attributes carry the nuance, one Overall carries the headline. |
| **Honest scale vs FIFA feel** | Rank with the honest blend, *display* on a FIFA curve. Engaging without distorting order. |
| **Volume vs quality in DEFENDING** | We possession-adjust defensive volume (fixing the bias against dominant-team defenders: Ramos 46→72). But with no tackle-success or positioning data, defensive *activity* can't be fully separated from *quality* — a high-volume CB can look elite. Stated, not hidden (see §7). |
| **Cross-competition aggregation** | One card per player across all their competitions. More data = higher confidence. The cost: a 2016 Euro self blends with a 2017/18 league self. |
| **Percentile vs z-score** | Percentile — directly explainable ("top 5 %") and robust to outliers. |
| **Coach: single Overall vs none** | We *do* give a headline Overall (the brief asks for an engaging, FIFA-like number), but make it a **results** signal, shrink it for small samples, and always show confidence stars — rather than dressing up a confounded "ability" score. Style lives in the 6-dim profile, kept separate from the quality number. |

---

## 7. Limitations (honest)

1. **DEFENDING measures possession-adjusted engagement, not pure quality.**
   Event data has no tackle-success or off-ball positioning, so a busy defender
   (e.g. Mustafi — more volume *and* better clearance accuracy than Ramos here)
   is statistically indistinguishable from an elite one. The multi-dimensional
   card mitigates this: it shows the one-dimensional profile.
2. **WORK RATE is involvement, not running.** No GPS/tracking data; off-ball
   work is invisible.
3. **Coach ratings are team-level proxies.** The Overall reflects *results*, not
   coaching ability in isolation — squad quality is inseparable in this data. We
   surface this directly (results-based blend + confidence stars) rather than
   hiding it; the tactical profile describes *style*, which is more genuinely
   attributable to the coach than the result is.
4. **Sub-positions are not distinguished.** Wyscout gives only GK/DF/MD/FW; a
   defensive midfielder and an attacking midfielder share the "MD" peer group.
5. **Single-season snapshot per league**; ratings stabilise with more seasons.

---

## 8. Evolution roadmap

| Stage | Addition | Impact |
|---|---|---|
| **V2** | **Expected Goals (xG)** from shot x/y | FINISHING becomes goals-vs-expected — rewards chance *quality*, not just volume. |
| **V3** | **Possession-adjust everywhere** + ball recoveries by pitch zone | Removes team-context bias from all defensive/keeper metrics. |
| **V4** | **Multi-season rolling ratings** + a form trajectory | "Are they improving?" — the per-match sparkline already computable. |
| **V5** | **Tracking data** | True work rate, pace, press resistance, off-ball movement. |
| **V6** | **Sub-position detection** | CDM/CM/CAM/winger/striker peer groups — fixes limitation #4. |

The architecture supports all of these: features are computed once into a
career table, and every rating is a transparent weighted blend of percentiles —
new signals slot in without reworking the pipeline.
