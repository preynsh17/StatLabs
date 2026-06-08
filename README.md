# AI-Powered FIFA World Cup 2026 Fantasy Intelligence Platform

> Predict player fantasy performance, discover hidden gems, recommend captains, and optimise squads for the 2026 FIFA World Cup — powered by XGBoost, Elo ratings, and integer linear programming.

---

## Project Overview

This project is a **end-to-end machine learning system** for FIFA World Cup 2026 fantasy football. It ingests historical player data from Transfermarkt and Understat (1.88 million player-match records, 2012–2026), trains a gradient-boosted model to predict per-match fantasy points, and applies tournament-specific context to rank all 929 matchable WC2026 players.

The system goes beyond pure ML: it layers an **Elo-based fixture difficulty engine**, a **multi-strategy recommendation engine**, and a **PuLP integer linear programme** to generate optimal squads under the official WC2026 fantasy constraints.

---

## Problem Statement

FIFA World Cup 2026 is the **first 48-team World Cup** — an expanded field that creates a significantly harder selection problem for fantasy managers. With 1,248 registered players across 48 nations, manually scouting value picks is infeasible. This platform automates:

- Who will score the most fantasy points in the group stage?
- Which underpriced players offer the best value?
- Who is the safest captain vs. the highest-ceiling captain?
- What is the optimal 15-man squad within a €100M budget?

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full system diagram.

```
Transfermarkt + Understat + WC2026 Squads + Elo Ratings + Fantasy Prices
        ↓
  Data Warehouse (1.88M rows)
        ↓
  Fantasy Scoring Validation
        ↓
  Feature Engineering (rolling windows, leakage-guarded)
        ↓
  XGBoost Regressor  →  Base Projections (RMSE: 2.647)
        ↓
  WC2026 Inference (929 / 1,248 players mapped)
        ↓
  Tournament Context Engine (Elo fixture multiplier: 0.5–1.5×)
        ↓
  Recommendation Engine (gems, safe captains, aggressive captains)
        ↓
  Multi-Objective Squad Optimizer (ILP, €100M budget)
```

---

## Dataset Description

| Source | Content | Size |
|--------|---------|------|
| **Transfermarkt** | Player appearances, market values, goals, assists, minutes (2012–2026) | 142 MB (appearances.csv) |
| **Understat** | Advanced metrics: xG, xA, shots, key passes per season | 4.8 MB |
| **WC2026 Squads** | 48-nation registered squad list (scraped) | 1,248 players |
| **Elo Ratings** | National team Elo scores for fixture difficulty | 48 nations |
| **FIFA Fantasy Prices** | Official player prices for budget constraint | 749 players |

**Final training dataset:** 1,804,657 rows × 17 features after cold-start filtering.

---

## Feature Engineering

All features are computed as **look-back rolling windows** with a mandatory `shift(1)` guard to prevent data leakage (features at time `t` only use data from `t-1` and earlier).

| Feature | Description |
|---------|-------------|
| `avg_fp_last_3` | Average fantasy points over last 3 appearances |
| `avg_fp_last_5` | Average fantasy points over last 5 appearances ← **#1 predictor** |
| `avg_goals_last_5` | Average goals scored in last 5 appearances |
| `avg_assists_last_5` | Average assists in last 5 appearances |
| `avg_minutes_last_5` | Average minutes played in last 5 ← **#2 predictor** |
| `std_fp_last_5` | Standard deviation of FP (volatility / upside signal) |
| `matches_played_last_5` | Count of appearances with >0 minutes in last 5 |
| `market_value_in_eur` | Transfermarkt market value in EUR (quality proxy) |
| `position` | Encoded position: Attack=0, Defender=1, GK=2, Midfield=3 |

**Fantasy Scoring System** (position-weighted):

| Event | GK | DEF | MID | ATT |
|-------|-----|-----|-----|-----|
| Goal | +9 | +7 | +6 | +5 |
| Assist | +3 | +3 | +3 | +3 |
| Played ≥60 min | +2 | +2 | +2 | +2 |
| Clean sheet | +4 | +4 | — | — |
| Yellow card | –1 | –1 | –1 | –1 |
| Red card | –3 | –3 | –3 | –3 |

---

## Modeling Approach

**Model:** XGBoost Regressor  
**Split strategy:** Strict chronological (train < 2023 | val 2023 | test 2024+)

| Model | RMSE | MAE | R² |
|-------|------|-----|----|
| Dummy (mean) | 2.7198 | 2.0742 | –0.004 |
| Linear Regression | 2.6805 | 2.0204 | 0.024 |
| Random Forest | 2.6453 | 1.9839 | 0.050 |
| **XGBoost (final)** | **2.6473** | **1.9690** | **0.051** |

XGBoost was selected for its speed on large datasets, native handling of missing values, and interpretability via SHAP.

> **Note on R²:** Individual match-level fantasy points are highly stochastic — injuries, refereeing decisions, and tactical changes cannot be predicted from historical form alone. The model's value is in **ranking players reliably**, not predicting exact scores. A 2.7% RMSE improvement over the dummy baseline is statistically meaningful at 350K test rows.

---

## Tournament Context Engine

Raw XGBoost projections are adjusted using **Elo-based fixture difficulty multipliers**.

```
win_probability = Elo_expected_score(team_A vs team_B)
multiplier      = 0.50 + (win_probability × 1.0)   → range [0.50, 1.50]

adjusted_projection = base_projection × mean(group_stage_multipliers)
```

A player from a strong nation facing weak opposition gets up to a **+50% boost**. A player from a weak nation in a group of death can see a **–50% penalty**. This re-ranking produces significantly different top-10 lists than raw model output.

---

## Explainability

SHAP (SHapley Additive exPlanations) values were computed using `TreeExplainer` across the full inference set.

**Key findings from SHAP:**
- `avg_fp_last_5` accounts for ~56% of total model gain — recent form dominates
- `avg_minutes_last_5` is 2nd — availability is a critical signal
- `market_value_in_eur` and `position` together encode player quality tier and role
- `std_fp_last_5` has a non-linear SHAP profile — moderate volatility is rewarded in the high-points tail

See `notebooks/09_explainability.ipynb` for waterfall plots per player and global importance charts.

---

## Squad Optimization

A **multi-objective integer linear programme** (PuLP + CBC solver) generates three distinct 15-man squads:

| Strategy | Objective |
|----------|-----------|
| **META** | Maximise raw projected fantasy points |
| **HIGH UPSIDE** | Maximise `points × (1 + volatility)` — tournament winner approach |
| **DIFFERENTIAL VALUE** | Maximise `(points / price) + gem_score × 0.1` — beat the field |

**Constraints for all strategies:**
- Exactly 15 players (2 GK, 5 DEF, 5 MID, 3 FWD)
- Total budget ≤ €100M
- Maximum 3 players per nation
- Integer diversity cuts prevent duplicate squads across strategies

**Hidden Gem Score:**
```
gem_score = percentile_rank(projected_points) − percentile_rank(price)
```
A player ranked 80th percentile for output but only 40th percentile for price has a gem score of 40.

---

## Results

| Metric | Value |
|--------|-------|
| Test set RMSE | 2.6473 pts |
| Test set MAE | 1.9690 pts |
| RMSE reduction vs dummy baseline | 2.7% |
| WC2026 squad mapping coverage | 74.4% (929 / 1,248 players) |
| Elite nation mapping (Argentina, England, Germany) | 100% |
| Fantasy price matching | 97.8% (742 / 749 priced players) |
| Players with full 5-match history | 95.8% of model rows |

---

## Key Insights

1. **Recent form beats everything.** `avg_fp_last_5` is the single most predictive feature — supporting the intuition that "hot hand" players should be prioritised.
2. **Availability is a first-class signal.** Players consistently getting 80+ minutes per game are rewarded heavily by the model, even over those with higher raw talent but inconsistent starts.
3. **Tournament context creates large re-rankings.** The Elo-adjusted top-10 is materially different from the raw top-10, confirming that fixture difficulty is alpha.
4. **Three strategies give genuinely different squads.** The META, UPSIDE, and VALUE optimisations consistently produce different personnel, validating that gem score and volatility signals carry independent information.

---

## Folder Structure

```
wc2026-fantasy/
│
├── data/
│   ├── raw/
│   │   ├── transfermarkt/         # Raw Transfermarkt CSV exports
│   │   ├── understat/             # Understat player/game stats + .db
│   │   └── global_results/        # International match results
│   └── processed/                 # Pipeline outputs (gitignored if >50MB)
│
├── models/
│   └── xgb_fantasy_model_v1.joblib   # Trained XGBoost model
│
├── notebooks/
│   ├── 01_data_audit.ipynb           # Raw data quality assessment
│   ├── 02_warehouse.ipynb            # Merge and clean all sources
│   ├── 03_fantasy_scoring.ipynb      # Scoring formula validation
│   ├── 04_feature_engineering.ipynb  # Rolling window features
│   ├── 05_modeling.ipynb             # Train + evaluate XGBoost
│   ├── 06_recommendation_engine.ipynb # Gems, captains, rankings
│   ├── 07_world_cup_inference.ipynb  # Map squads → predictions
│   ├── 08_fixture_difficulty_engine.ipynb  # Elo context adjustment
│   ├── 09_explainability.ipynb       # SHAP analysis
│   ├── 10_squad_optimizer.ipynb      # ILP squad optimization
│   └── 11_project_evaluation.ipynb  # Capstone summary
│
├── scrapers/
│   ├── elo_ratings/               # Elo + fixture scrapers
│   ├── fifa_fantasy/              # Fantasy price scraper
│   └── fifa_squads/               # WC2026 squad scraper
│
├── archive/                       # Experimental/supplementary notebooks
├── reports/                       # Generated charts and analysis outputs
├── docs/
│   └── architecture.md            # System architecture documentation
│
├── README.md
├── requirements.txt
└── .gitignore
```

---

## Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/wc2026-fantasy.git
cd wc2026-fantasy

# Create a virtual environment
python3.11 -m venv .venv
source .venv/bin/activate        # macOS/Linux
# .venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Launch Jupyter
jupyter lab
```

---

## Reproducibility

Run notebooks in order: **01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11**

Each notebook reads from `data/processed/` outputs of the prior step. The trained model (`models/xgb_fantasy_model_v1.joblib`) is included in the repository — you can start from **Notebook 06** onwards without re-training.

**Data note:** Raw data files >50 MB are excluded from the repository (see `.gitignore`). Source the Transfermarkt data via the [Transfermarkt Scraper](https://github.com/dcaribou/transfermarkt-scraper) and Understat data via the Understat API.

**Scrapers:** Run the scripts in `scrapers/` to refresh WC2026 squad lists, fantasy prices, Elo ratings, and fixtures before each tournament round.

---

## Future Improvements

- **Round-by-round retraining** — Refresh rolling features after each matchday
- **Streamlit dashboard** (`app/`) — Live fantasy assistant with auto-refresh
- **LSTM/Transformer** — Replace rolling windows with learned sequence representations
- **Expand squad mapping** — Multilingual fuzzy matching to close the 25.6% coverage gap
- **Bayesian calibration** — Better uncertainty quantification for captaincy decisions
- **Automated data pipeline** — GitHub Actions for tournament-week data refresh

---

## Tech Stack

Python 3.11 · pandas · numpy · XGBoost · scikit-learn · SHAP · PuLP · Playwright · matplotlib · seaborn · joblib

---

*Built for FIFA World Cup 2026 — June 2026*
