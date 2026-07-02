> ## ✅ STATUS: LOCKED (2026-06-22)
> All decisions below are confirmed and implemented in `wyscout_lib.py`.
> Final calls made during review:
> - **GK:** added **clean-sheet rate** (20%) to SHOT STOPPING.
> - **DF Overall weights:** PASSING 25 · CREATIVITY 10 · FINISHING 5 · **DEFENDING 52** · WORK RATE 8 (work-rate capped so "busy" defenders aren't double-rewarded).
> - **Header scoring:** tag 403 = header confirmed; `header_goals_p90` added to DEFENDING (10%) so set-piece scorers get credit.
> - **B3 scale:** honest blend ranks players, then re-percentiled onto a **FIFA curve** (median ~73, elite 90+, top ~98).
> - **B4 defending:** **possession-adjusted** volume (option b) — fixed elite CBs (Ramos 46→72, van Dijk→73, Hummels→71).
> - **D (extra features):** not included in V1.
>
> **Known limitation accepted:** with no tackle-success / positioning data, defensive *activity* cannot be separated from defensive *quality*. A high-volume CB (e.g. Mustafi) is statistically indistinguishable from a truly elite one — he posts more volume AND higher clearance accuracy than Ramos/Hummels. This is documented in the methodology rather than hidden.

> ## ✅ COACH REVISION (2026-06-24)
> The coach card was upgraded to match the player card's richness:
> - **FIFA-style Overall (1–99)** added for every coach — a **results** blend (points/match 65 % + goal-diff/match 35 %), **shrunk** toward the mean with `K=6` matches, then mapped onto the **same FIFA curve** as players. Confidence stars (≥34→5★ … ≥1→1★) sit beside it. Deliberately a *results* number, not a "coaching ability" score — the squad/coaching confound is shown (stars + framing), not hidden.
> - **Tactical profile expanded 4 → 6 dimensions:** added **Width** (crosses/match — wing vs central) and **Line Height** (avg x of the team's defensive actions — high line vs deep block). **Possession** was changed from raw pass *volume* to true pass *share* (not inflated by tempo / extra time).
> - **Richer archetypes:** Gegenpress, High-Press Architect, Deep Block, Wing-Overload, etc., driven by the 6 dims.
> - **Per-dimension explainability + tactical-trait chips** now ship in `ratings.json`, exactly like players.
> - **Reproducible audit:** `00_eda.ipynb` added — every Phase-0 data decision (goal source, tag meanings, coordinates, encoding traps) is now *proven live from the raw files*, replacing the prior "audit complete" assertion.
>
> Sanity: City = 99 / Possession Master; Liverpool & Spurs = Gegenpress; Atlético = Defensive Organizer; Barça = lowest Width; Deschamps' France high Overall but low confidence (record only).

---

# Rating Decisions — Review & Sign-off

**Purpose:** every decision behind the ratings, split into **(A) already taken**,
**(B) proposed — needs your sign-off**, and the **(C) features available** /
**(D) features we could engineer**. Once you confirm Part B, we lock the engine
and move to the coach ratings + web app.

---

## 0. The one clarification that matters most

**A leaderboard rank is not a rating.**

The Top-25 lists you reviewed (Phase 4) are **single-metric sanity checks** —
"sort everyone by goals per 90." They exist only to confirm the *data* is right
(do the famous strikers show up?). They are **not** the player rating.

The actual rating (Phase 5) is **multi-dimensional**:

```
                 ┌─ PASSING      (blend of 4 sub-metrics)
                 ├─ CREATIVITY   (blend of 4 sub-metrics)
 OVERALL  =  Σ ( ├─ FINISHING    (blend of 4 sub-metrics)  ) × position weight
                 ├─ DEFENDING    (blend of 5 sub-metrics)
                 └─ WORK RATE    (blend of 2 sub-metrics)
```

So **Salah is rank #1 in the goals/90 leaderboard, but his FINISHING attribute
is ~84, not 99** — because FINISHING also weighs shot accuracy, shots on target,
and shot distance, and he is not #1 in all of those. And his **Overall** further
blends in his passing, creativity, defending and work rate. Goals/90 is one
input among ~19. That is exactly the "a forward should depend on several
metrics" behaviour you asked for — it's already how it works.

---

# PART A — Decisions already taken (locked, validated)

### A1. Who gets a rating? (the "too few games" rule)

Three layers handle small samples, so we never throw away a player *or* pretend a
cameo is proven:

| Layer | Rule | Why |
|---|---|---|
| **Hard floor** | < **45 minutes** total → **not rated** at all | Below ~half a match there isn't enough signal for any per-90 to mean anything. **217 of 3,020 players excluded.** |
| **Confidence shrinkage** | Every score is pulled toward the position average, weight = `minutes / (minutes + 180)` | A player with 90 min is weighted ~33% on their own data, 67% on the "average peer." A player with 3,000 min is ~94% their own data. A great *hour* can't outrank a great *season*. |
| **Confidence stars** | Displayed on the card so the user sees the sample size | Honest: a 5★ rating ≠ a 1★ rating even at the same number. |

**Confidence star bands (by total minutes):**

| Stars | Minutes | ≈ Matches | Players |
|---|---|---|---|
| ★★★★★ | ≥ 1800 | 20+ | 992 |
| ★★★★☆ | 900–1799 | 10–20 | 673 |
| ★★★☆☆ | 450–899 | 5–10 | 331 |
| ★★☆☆☆ | 180–449 | 2–5 | 433 |
| ★☆☆☆☆ | 45–179 | < 2 | 374 |
| — | < 45 | — | excluded (217) |

> The `180` shrinkage constant ("K") means *2 matches' worth of minutes is the
> 50/50 tipping point.* Bigger K = more conservative (pulls harder toward
> average). **This number is tunable — see B5.**

### A2. Data-engineering decisions (validated against ground truth)

| Decision | Rule | Evidence |
|---|---|---|
| **Goals** | Use the **lineup `goals` field** (authoritative), not event tags | Event tag 101 also fires on *conceded* shots & shootouts. Lineup goals matched events **100%** (5,049 vs 5,048) and Kane WC = exactly 6. |
| **Shot on target** | tag **1801** on a Shot (not 402) | Every shot carries exactly one of 1801/1802; all goals carry 1801. The 402 bug had Messi at 24.7% accuracy. |
| **Assists** | Derived from **event tag 301** (uniform), not the lineup field | Lineup `assists` is null in all 5 leagues. |
| **Cards** | Lineup stores the *minute* of the card → converted to a 0/1 occurrence; red-card minute also trims minutes played | The raw values (1–118) are minutes, not counts. |
| **Names** | Decode `\uXXXX` escapes (899 players affected) | `A. Aréola` → `A. Aréola`. |
| **Coordinates** | Team-relative; progressive pass = `end_x > start_x + 10` | Confirmed: shots originate from x≈96 toward goal at x=100. |
| **Minutes** | From lineup + substitution minutes, capped at 90 (or 120 for extra-time matches) | All minutes land in [0, 120]; no negatives. |
| **Own goals** | Never counted as a goal | We use the lineup `goals` field, which already excludes them. |

### A3. Position normalisation (locked)

Every sub-metric is converted to a **percentile rank within the player's own
position group** (GK / DF / MD / FW). A centre-back's passing is ranked against
other centre-backs, never against wingers. Rate metrics (accuracy %, save %)
only count once a **minimum volume** is reached (e.g. ≥ 5 shots before shot
accuracy counts), so "1 of 1 = 100%" can't masquerade as elite.

### A4. The Top-25 leaderboards (locked — they are a *tool*, not the product)

Single-metric, ≥ 1000-minute pool, used to validate the feature layer. They will
**not** appear in the final product. They already passed: Messi/Ronaldo/Salah top
finishing, De Bruyne/Özil top creativity, Oblak/Neuer top keepers, ball-playing
CBs top progressive passing.

---

# PART B — Proposed, needs your sign-off

This is the part to confirm or adjust. **These are the knobs that decide the
final number.**

### B1. The five attributes & their sub-metric weights

*(each sub-metric → percentile within position → weighted blend → 0–99)*

**PASSING**
| Sub-metric | Weight |
|---|---|
| Pass completion % | 35% |
| Progressive passes / 90 | 30% |
| Final-third pass rate | 20% |
| Pass-type richness (smart+cross / total) | 15% |

**CREATIVITY**
| Sub-metric | Weight |
|---|---|
| Final-third passes / 90 | 30% |
| Passes into box / 90 | 25% |
| Smart passes / 90 | 25% |
| Key passes (shot assists) / 90 | 20% |

**FINISHING**
| Sub-metric | Weight |
|---|---|
| Goals / 90 | 40% |
| Shot accuracy % | 30% |
| Shots on target / 90 | 20% |
| Avg shot distance (closer = better) | 10% |

**DEFENDING**
| Sub-metric | Weight |
|---|---|
| Clearances / 90 | 30% |
| Clearance accuracy % | 20% |
| Possession-won actions / 90 | 20% |
| Aerial duels / 90 | 15% |
| Defensive duels / 90 | 15% |

**WORK RATE**
| Sub-metric | Weight |
|---|---|
| Total events / 90 (involvement) | 60% |
| Duels entered / 90 | 40% |

**Goalkeepers** swap two slots:
- **CREATIVITY → DISTRIBUTION:** goal-kick accuracy 40%, pass completion 40%, progressive passes/90 20%
- **FINISHING → SHOT STOPPING:** save % 70%, saves/90 15%, reflexes/90 15%
  *(save% leads because it's a rate — not confounded by how busy the keeper is)*

> ❓ **Confirm:** are these sub-metrics and weights the right definition of each
> attribute? (e.g. should CREATIVITY weight key passes higher than 20%?)

### B2. Overall = position-specific weighting of the five attributes

| Position | PASSING | CREATIVITY | FINISHING | DEFENDING | WORK RATE |
|---|---|---|---|---|---|
| **GK** | 15% | 26% (DIST) | 55% (STOP) | 2% | 2% |
| **DF** | 25% | 15% | 5% | 35% | 20% |
| **MD** | 25% | 25% | 10% | 20% | 20% |
| **FW** | 20% | 25% | 35% | 5% | 15% |

> ❓ **Confirm:** do these weights match how you'd value each role? This is the
> single biggest lever on the Overall number. (e.g. is FINISHING 35% enough for a
> striker? should a DF's DEFENDING be more than 35%?)

### B3. ⚠️ Open question — should the Overall be *stretched* to a FIFA-like spread?

Right now the Overall is a **weighted average of percentile scores**, so it
clusters around 50 and the **best player sits at ~83, not 99.** That is
statistically honest but doesn't *feel* like a FIFA card (where the best are
90+).

Two options:

| Option | What the top player looks like | Trade-off |
|---|---|---|
| **(current) Keep raw blend** | Best ≈ 83, most players 40–60 | Honest, but visually flat |
| **Re-percentile the Overall** | Best ≈ 99, full 1–99 spread | More engaging / FIFA-like, but it's a cosmetic stretch |

> ❓ **Decide:** keep the honest compressed scale, or stretch the Overall into a
> full 1–99 spread for the card?

### B4. ⚠️ Open question — DEFENDING is volume-based (team-context confound)

DEFENDING rewards *defensive engagement volume* (clearances, duels). The
side-effect: **defenders on dominant teams defend less, so they score lower.**
Sergio Ramos's DEFENDING is ~46th percentile because Real Madrid has the ball;
his Overall is rescued by his elite PASSING (75) and "Ball-Playing Defender"
archetype.

Options: **(a)** accept it and document (current), **(b)** possession-adjust
defensive volume (needs a team-possession estimate — engineering work, see D3),
or **(c)** lean DEFENDING harder on the *rate* metrics we have (clearance
accuracy, duel involvement) instead of raw volume.

> ❓ **Decide:** accept & document, or invest in possession-adjustment?

### B5. Other tunable knobs (defaults shown — confirm or change)

| Knob | Current default | Effect of changing |
|---|---|---|
| Min-minutes floor | 45 | Higher = fewer, more-reliable players |
| Shrinkage K | 180 (≈2 matches) | Higher = small-sample players pulled harder to average |
| Min volume for rate metrics | 5 shots / 20 passes / 5 clearances | Higher = stricter "earned" rates |
| Star bands | 45/180/450/900/1800 | Cosmetic; defines ★ thresholds |
| "Insufficient data" rule | FW with < 3 shots shows FINISHING = "—" | Avoids a misleading 0 |

### B6. Archetypes (deterministic, proposed)

16 labels assigned by rules on the five scores (no ML — too few players per
group). Examples: FW with FINISHING≥70 & CREATIVITY≥70 → *Complete Forward*;
MD with DEFENDING≥70 & CREATIVITY<40 → *Defensive Midfielder*; GK with save%
slot ≥75 → *Shot Stopper*. Everyone gets a label (default "All-Round [Position]").

> ❓ **Confirm:** keep the rule-based archetype set as-is?

---

# PART C — Features currently available (computed, ready to use)

From the **53,380-row** match table and **3,020-player** career table:

**Per-90 rates (23):** goals, assists, shots, shots on target, key passes, smart
passes, passes (total), progressive passes, final-third passes, passes into box,
crosses, duels (total), defensive duels, aerial duels, attacking duels,
clearances, possession-won actions, accelerations, touches, fouls, saves,
reflexes, total events.

**Accuracy rates (6):** pass completion, shot accuracy, clearance accuracy, cross
accuracy, goal-kick accuracy, save %.

**Counting / context (selected):** goals, assists, shots, minutes, matches,
yellow/red cards, avg shot distance, goals conceded (for GK save%), competitions
list, position, height, weight, foot, nationality.

---

# PART D — Features we *could* engineer (not yet built)

Ordered by value-for-effort. None are required to ship V1; flagging what's
possible with this data.

| # | Feature | What it adds | Effort |
|---|---|---|---|
| **D1** | **Expected Goals (xG)** from shot x/y (distance + angle) | FINISHING becomes "goals vs expected" — rewards *quality* of chances, not just volume; separates finishers from high-volume shooters | Medium (build a simple distance/angle xG curve from the 80k shots we have) |
| **D2** | **Progressive carries** (dribbles that advance the ball) from "Others on the ball" + Acceleration events | A real ball-carrying dimension (currently only in WORK RATE as volume) | Low–Medium |
| **D3** | **Possession-adjusted defending** (defensive actions per unit of opponent possession) | Fixes the B4 confound — fair to defenders on dominant teams | Medium (need per-match team possession estimate from pass counts) |
| **D4** | **Pressing / ball recoveries in opponent half** (x-position of defensive actions) | A "pressing intensity" signal for both players and coaches | Low |
| **D5** | **Set-piece vs open-play split** for goals/assists | Separates penalty merchants & dead-ball specialists | Low |
| **D6** | **Pass network centrality** (who the team builds through) | A "team importance" signal | High |
| **D7** | **Form / trajectory** (per-match rating sparkline, already scoped) | The "are they improving?" view for the card | Low (per-match scores already computable) |
| **D8** | **Discipline / reliability** (fouls, cards, turnovers per 90) | A negative-actions dimension | Low |

---

# What I need from you to proceed

1. **Part B1** — sub-metric weights per attribute: OK as-is, or adjust?
2. **Part B2** — Overall position weights: OK, or adjust?
3. **Part B3** — keep honest scale (max ~83) or stretch to FIFA-like 1–99?
4. **Part B4** — DEFENDING: accept & document, or build possession-adjustment (D3)?
5. **Part B5** — any knob changes (floor, K, star bands)?
6. **Part D** — any of these to include in V1 (esp. **D1 xG** and **D7 form**)?

Once you confirm, I lock the engine and build: coach ratings → `ratings.json`
export → `process.py` (one-command rebuild) → the web app → methodology doc.
