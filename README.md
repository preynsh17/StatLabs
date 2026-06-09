---
title: StatLabs API
emoji: ⚽
colorFrom: green
colorTo: blue
sdk: docker
pinned: false
app_port: 7860
---

# StatLabs

AI powered fantasy intelligence for FIFA World Cup 2026. Get optimal squads, captain picks, and hidden gems — all from a live web app.

**Live app:** [statlabs-preynsh.vercel.app](https://statlabs-preynsh.vercel.app)

## What it does

Open the app and you get:

- **Squad Builder** — generates an optimal 15-player squad within a $100M budget using three strategies: balanced (best projected points), high upside (boom or bust ceiling), and value (underpriced players who outperform their cost)
- **Player Pool** — full list of 929 WC2026 players ranked by projected fantasy points, adjusted for fixture difficulty
- **Gem Score** — flags players who rank significantly higher on output than on price, surfacing value picks the market has missed
- **Captain Picks** — splits recommendations into safe captains (consistent performers) and aggressive captains (high ceiling, higher variance)
- **Anchor support** — lock in any player you want to keep and regenerate the rest of the squad around them

## How projections work

Player projections are built from 1.88 million historical match records (2012 to 2026). An XGBoost model is trained on recent form — average fantasy points and minutes played over the last 5 appearances are the strongest signals. Those base projections are then adjusted by a fixture difficulty engine: players facing weaker opposition get boosted, players in tough groups get penalised. The final number is what the squad optimizer uses.

Fantasy points follow the official scoring system:

| Event | Goalkeeper | Defender | Midfielder | Forward |
|---|---|---|---|---|
| Goal | 9 | 7 | 6 | 5 |
| Assist | 3 | 3 | 3 | 3 |
| Played 60+ min | 2 | 2 | 2 | 2 |
| Clean sheet | 4 | 4 | 0 | 0 |
| Yellow card | -1 | -1 | -1 | -1 |
| Red card | -3 | -3 | -3 | -3 |

## Tech stack

Python · FastAPI · XGBoost · PuLP · Next.js · Deployed on Hugging Face Spaces (API) and Vercel (frontend)

## Running locally

```bash
git clone https://github.com/preynsh17/StatLabs.git
cd StatLabs

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

uvicorn main:app --reload
```

Frontend:

```bash
cd frontend
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev
```
