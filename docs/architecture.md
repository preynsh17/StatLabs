# System Architecture
## AI-Powered FIFA World Cup 2026 Fantasy Intelligence Platform

---

## Pipeline Overview

```
╔══════════════════════════════════════════════════════════════════╗
║                        DATA SOURCES                              ║
╠═══════════════╦═══════════════╦═════════════╦════════════════════╣
║  Transfermarkt ║   Understat   ║  WC2026     ║  Elo Ratings &     ║
║  (Appearances, ║  (xG, xA,    ║  Squad List ║  Fixture Schedule  ║
║   Market Value,║   Shots,     ║  (1,248     ║  (48 nations,      ║
║   Goals, Asst) ║   Key Passes)║   players)  ║   Group Stage)     ║
║  1.88M rows   ║  620K rows   ║             ║                    ║
╚═══════════════╩═══════════════╩═════════════╩════════════════════╝
         │                │              │               │
         └────────────────┴──────────────┴───────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │    02: DATA WAREHOUSE      │
                    │  Merge appearances ×       │
                    │  players × games           │
                    │  → player_match_stats_     │
                    │    clean.csv (410 MB)      │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  03: FANTASY SCORING       │
                    │  Position-weighted FP      │
                    │  GK=9, DEF=7, MID=6,       │
                    │  ATT=5 (per goal)          │
                    │  → fantasy_points target   │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  04: FEATURE ENGINEERING   │
                    │  Rolling windows (L3, L5)  │
                    │  • avg_fp_last_3/5         │
                    │  • avg_goals_last_5        │
                    │  • avg_assists_last_5      │
                    │  • avg_minutes_last_5      │
                    │  • std_fp_last_5           │
                    │  • matches_played_last_5   │
                    │  + Understat: xG, xA,      │
                    │    shots, key_passes (opt) │
                    │  Shift(1) leakage guard    │
                    │  → 1,804,657 clean rows    │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  05: XGBOOST MODEL         │
                    │  Chronological split:      │
                    │  Train: 2012–2022 (1.3M)   │
                    │  Val:   2023     (146K)    │
                    │  Test:  2024+    (350K)    │
                    │                            │
                    │  Final metrics (test):     │
                    │  RMSE = 2.6473             │
                    │  MAE  = 1.9690             │
                    │  R²   = 0.0508             │
                    │                            │
                    │  → xgb_fantasy_model_v1    │
                    │    .joblib (848 KB)        │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  07: WC2026 INFERENCE      │
                    │  Map WC squads →           │
                    │  Transfermarkt IDs         │
                    │  Exact: 862 matches        │
                    │  Fuzzy @85%: 67 matches    │
                    │  Coverage: 929/1,248(74%)  │
                    │  Cold-start: median impute │
                    │  → world_cup_predictions   │
                    │    _final.csv              │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  08: TOURNAMENT CONTEXT    │
                    │  Elo-based fixture         │
                    │  difficulty multiplier     │
                    │  multiplier = 0.5 +        │
                    │    (win_prob × 1.0)        │
                    │  Range: [0.50, 1.50]       │
                    │  Group Stage avg applied   │
                    │  → world_cup_predictions   │
                    │    _adjusted.csv           │
                    └────────────┬──────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
┌─────────────▼─────────────┐       ┌──────────────▼──────────────┐
│  06: RECOMMENDATION        │       │  10: SQUAD OPTIMIZER         │
│  ENGINE                   │       │                              │
│  Player snapshot:          │       │  PuLP Integer LP             │
│  • Best Overall            │       │  Objective (3 strategies):   │
│  • Hidden Gems             │       │  META: max Σ points          │
│  • Safe Captains           │       │  UPSIDE: max Σ pts×(1+vol)   │
│    score = pts/(1+vol)     │       │  VALUE: max Σ pts/price+gem  │
│  • Aggressive Captains     │       │                              │
│    score = pts×(1+vol)     │       │  Constraints:                │
│  • Differential Captains   │       │  • 15 players total          │
│    score = pts×(1+gem_pct) │       │  • €100M budget              │
│                            │       │  • 2 GK, 5 DEF, 5 MID, 3 FWD│
│  gem_score =               │       │  • Max 3 per nation          │
│  percentile(pts) −         │       │  • Diversity cuts            │
│  percentile(price)         │       │                              │
└─────────────┬─────────────┘       └──────────────┬──────────────┘
              │                                     │
              └──────────────┬──────────────────────┘
                             │
               ┌─────────────▼──────────────┐
               │  09: EXPLAINABILITY (SHAP)  │
               │  TreeExplainer             │
               │  • Global density plots    │
               │  • Feature importance bar  │
               │  • Waterfall decomposition │
               │    per player              │
               └─────────────┬──────────────┘
                             │
               ┌─────────────▼──────────────┐
               │  11: PROJECT EVALUATION     │
               │  Capstone summary notebook  │
               │  Benchmarks + visualisations│
               │  Key findings & limitations │
               └────────────────────────────┘
```

---

## Component Detail

### Data Sources

| Source | Format | Size | Used In |
|--------|--------|------|---------|
| Transfermarkt appearances | CSV | 142 MB | NB 02, 04 |
| Transfermarkt games | CSV | 25 MB | NB 02 |
| Transfermarkt game_lineups | CSV | 335 MB | NB 02 |
| Transfermarkt players | CSV | 16 MB | NB 02 |
| Understat player_stats | CSV | 4.8 MB | NB 04 |
| Global match results | CSV | 3.4 MB | NB 02 |
| WC2026 squad list | CSV (scraped) | <1 MB | NB 07 |
| Elo ratings | CSV (scraped) | <1 MB | NB 08 |
| WC2026 fixtures | CSV (scraped) | <1 MB | NB 08 |
| FIFA fantasy prices | CSV (scraped) | <1 MB | NB 10 |

### Model Architecture

```
XGBoost Regressor (xgb_fantasy_model_v1)
├── n_estimators: 200
├── max_depth: 6
├── learning_rate: 0.1
├── subsample: 0.8
├── colsample_bytree: 0.8
└── random_state: 42

Feature vector (9 dimensions):
[position, market_value_in_eur, avg_fp_last_3, avg_fp_last_5,
 avg_goals_last_5, avg_assists_last_5, avg_minutes_last_5,
 std_fp_last_5, matches_played_last_5]
```

### Fixture Difficulty Multiplier

```
win_probability = Elo_based_expected_score(team_A vs team_B)
multiplier = 0.50 + (win_probability × 1.0)

Easy group (win_prob = 0.80) → multiplier = 1.30  (+30% boost)
Hard group (win_prob = 0.25) → multiplier = 0.75  (−25% penalty)

adjusted_projection = base_projection × mean(group_stage_multipliers)
```

### Squad Optimizer Objective Functions

```python
# META: raw expected value
maximize Σ points[p] × x[p]

# UPSIDE: volatility-weighted (tournament winners)
maximize Σ (points[p] × (1 + volatility[p])) × x[p]

# VALUE: points per euro + gem discount
maximize Σ ((points[p] / price[p]) + gem_score[p] × 0.1) × x[p]

# Subject to:
Σ x[p]                         == 15         # 15-man squad
Σ price[p] × x[p]              <= 100        # €100M budget
Σ x[p] for p in GK             == 2
Σ x[p] for p in DEF            == 5
Σ x[p] for p in MID            == 5
Σ x[p] for p in FWD            == 3
Σ x[p] for p in country_c      <= 3          # ∀ country c
```

---

## Data Flow Diagram

```
data/raw/
  transfermarkt/        ──┐
  understat/            ──┤──► NB 02 ──► player_match_stats_clean.csv
  global_results/       ──┘               │
                                           ▼
scrapers/                              NB 03 (validate scoring)
  elo_ratings/output/   ──────────────────►NB 08
  fifa_squads/output/   ──────────────────►NB 07
  fifa_fantasy/output/  ──────────────────►NB 10
                                           │
                        NB 04 ◄────────────┘
                          │
                          ▼
                    model_dataset_final.csv
                    train.csv / val.csv / test.csv
                          │
                        NB 05
                          │
                          ▼
                    xgb_fantasy_model_v1.joblib
                    test_predictions.csv
                          │
                        NB 06 ──► recommendation outputs
                        NB 07 ──► world_cup_predictions_final.csv
                          │
                        NB 08 ──► world_cup_predictions_adjusted.csv
                          │
                        NB 09 ──► SHAP visualisations
                        NB 10 ──► master_player_pool.csv + optimised squads
                        NB 11 ──► reports/ (summary charts)
```

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | Python 3.11 |
| Data manipulation | pandas 3.x, numpy 2.x |
| Machine learning | XGBoost 3.x, scikit-learn 1.9 |
| Explainability | SHAP |
| Optimisation | PuLP (CBC solver) |
| Scraping | Playwright, BeautifulSoup4, requests |
| Visualisation | matplotlib, seaborn |
| Notebooks | JupyterLab |
| Model persistence | joblib |
| String matching | difflib (fuzzy) + unicodedata (normalisation) |
