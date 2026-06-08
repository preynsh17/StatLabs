import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pulp import *

app = FastAPI(title="StatLabs API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://statlabs-preynsh.vercel.app",
        "http://localhost:3000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

df = pd.read_csv("data/processed/master_player_pool.csv")
df = df.dropna(subset=['player'])
numeric_cols = ['price', 'adjusted_projection', 'std_fp_last_5', 'gem_score_adj']
df[numeric_cols] = df[numeric_cols].replace([np.inf, -np.inf], np.nan)
df['price'] = df['price'].fillna(df['price'].median())
df['adjusted_projection'] = df['adjusted_projection'].fillna(0)
df['std_fp_last_5'] = df['std_fp_last_5'].fillna(0)
df['gem_score_adj'] = df['gem_score_adj'].fillna(0)

players = df['player'].tolist()
costs = dict(zip(players, df['price']))
points = dict(zip(players, df['adjusted_projection']))
positions = dict(zip(players, df['position']))
countries = dict(zip(players, df['country']))
volatility = dict(zip(players, df['std_fp_last_5']))
gem_scores = dict(zip(players, df['gem_score_adj']))

class SquadRequest(BaseModel):
    strategy: str = "meta"
    anchors: list[str] = []
    n_squads: int = 1

@app.get("/players")
def get_players():
    return df.to_dict(orient="records")

@app.post("/generate")
def generate_squad(req: SquadRequest):
    if req.strategy not in ["meta", "upside", "value"]:
        raise HTTPException(status_code=400, detail="Invalid strategy")

    for anchor in req.anchors:
        if anchor not in players:
            raise HTTPException(status_code=400, detail=f"Anchor {anchor} not found")

    n = max(1, min(req.n_squads, 5))

    player_vars = LpVariable.dicts("Select", players, cat=LpBinary)
    prob = LpProblem(f"WC2026_{req.strategy}", LpMaximize)

    if req.strategy == "meta":
        prob += lpSum([points[p] * player_vars[p] for p in players])
    elif req.strategy == "upside":
        prob += lpSum([(points[p] * (1 + volatility[p])) * player_vars[p] for p in players])
    elif req.strategy == "value":
        prob += lpSum([((points[p] / costs[p]) + (gem_scores[p] * 0.1)) * player_vars[p] for p in players])

    prob += lpSum([player_vars[p] for p in players]) == 15
    prob += lpSum([costs[p] * player_vars[p] for p in players]) <= 100.0
    prob += lpSum([player_vars[p] for p in players if positions[p] == 2]) == 2
    prob += lpSum([player_vars[p] for p in players if positions[p] == 3]) == 5
    prob += lpSum([player_vars[p] for p in players if positions[p] == 1]) == 5
    prob += lpSum([player_vars[p] for p in players if positions[p] == 0]) == 3

    for country in set(countries.values()):
        prob += lpSum([player_vars[p] for p in players if countries[p] == country]) <= 3

    for anchor in req.anchors:
        prob += player_vars[anchor] == 1.0

    squads = []
    for i in range(n):
        prob.solve(PULP_CBC_CMD(msg=0))

        if prob.status != 1:
            break

        selected = [p for p in players if player_vars[p].varValue == 1.0]
        df_sq = df[df['player'].isin(selected)].sort_values(
            by=['position', 'price'], ascending=[False, False]
        )
        squads.append({
            "squad": df_sq.to_dict(orient="records"),
            "total_cost": round(df_sq['price'].sum(), 1),
            "total_points": round(df_sq['adjusted_projection'].sum(), 2),
        })

        if i < n - 1:
            # No-good cut: next squad must differ by at least 4 players
            cut_name = f"no_good_{i}"
            prob += (
                lpSum([player_vars[p] for p in selected]) <= 11,
                cut_name
            )

    if not squads:
        raise HTTPException(
            status_code=400,
            detail="Could not find an optimal squad with these anchors."
        )

    return {
        "squads": squads,
        # Backwards-compatible single-squad fields
        "squad": squads[0]["squad"],
        "total_cost": squads[0]["total_cost"],
        "total_points": squads[0]["total_points"],
    }
