"""
Update master_player_pool.csv with official FIFA positions and prices.

Sources:
  - scrapers/fifa_squads/output/wc2026_players.csv  → correct positions (100% match)
  - scrapers/fifa_fantasy/output/fantasy_prices.csv  → official FIFA Fantasy prices
"""

import unicodedata
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).parent.parent

MASTER = ROOT / "data/processed/master_player_pool.csv"
SQUADS = ROOT / "scrapers/fifa_squads/output/wc2026_players.csv"
FANTASY = ROOT / "scrapers/fifa_fantasy/output/fantasy_prices.csv"

POS_MAP = {"Forward": 0, "Midfielder": 1, "Goalkeeper": 2, "Defender": 3}


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip()


def build_fantasy_price_lookup(fantasy: pd.DataFrame) -> dict:
    """Map normalized full_name → price. Skips duplicate full_names."""
    seen: dict[str, list] = {}
    for _, row in fantasy.iterrows():
        key = normalize(row["full_name"])
        seen.setdefault(key, []).append(float(row["price"]))
    return {k: v[0] for k, v in seen.items() if len(v) == 1}


def word_overlap_match(master_name: str, fantasy: pd.DataFrame) -> float | None:
    """
    Match master player name against fantasy full_names via word overlap.
    Returns price if exactly one candidate has all master-name words as a subset
    of their full_name words.
    """
    words = set(normalize(master_name).split())
    candidates = []
    for _, row in fantasy.iterrows():
        full_words = set(normalize(row["full_name"]).split())
        if words.issubset(full_words):
            candidates.append(float(row["price"]))
    return candidates[0] if len(candidates) == 1 else None


def main():
    master = pd.read_csv(MASTER)
    squads = pd.read_csv(SQUADS)
    fantasy = pd.read_csv(FANTASY)

    squads_lookup = {normalize(r["name"]): r for _, r in squads.iterrows()}
    fantasy_exact = build_fantasy_price_lookup(fantasy)

    pos_changed = 0
    price_updated = 0
    pos_unmatched = []
    price_unmatched = []

    for idx, row in master.iterrows():
        key = normalize(row["player"])

        # --- Position ---
        sq = squads_lookup.get(key)
        if sq is not None:
            new_pos = POS_MAP[sq["position"]]
            if new_pos != row["position"]:
                master.at[idx, "position"] = new_pos
                pos_changed += 1
        else:
            pos_unmatched.append(row["player"])

        # --- Price: try exact full_name match first, then word-overlap ---
        new_price = fantasy_exact.get(key)
        if new_price is None:
            new_price = word_overlap_match(row["player"], fantasy)

        if new_price is not None:
            if abs(new_price - row["price"]) > 0.05:
                master.at[idx, "price"] = new_price
                price_updated += 1
        else:
            price_unmatched.append(row["player"])

    master.to_csv(MASTER, index=False)

    print(f"Positions fixed:  {pos_changed}/{len(master)}")
    print(f"Prices updated:   {price_updated}/{len(master)}")
    if pos_unmatched:
        print(f"\nPosition unmatched ({len(pos_unmatched)}):")
        for p in pos_unmatched:
            print(f"  {p}")
    if price_unmatched:
        print(f"\nPrice unmatched ({len(price_unmatched)}) — kept existing price")

    # Spot-checks
    print("\nSpot-checks:")
    checks = ["Achraf HAKIMI", "ALEX SANDRO", "Adrien RABIOT", "ALI ALHAMADI", "ALISSON"]
    pos_names = {0: "FWD", 1: "MID", 2: "GK", 3: "DEF"}
    for name in checks:
        r = master[master["player"] == name]
        if not r.empty:
            row = r.iloc[0]
            print(f"  {name}: pos={pos_names[row['position']]}  price=${row['price']}")

    print("\nFinal position distribution:")
    print(master["position"].map(pos_names).value_counts().to_string())


if __name__ == "__main__":
    main()
