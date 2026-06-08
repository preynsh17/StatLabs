import type { Player, SquadRequest, SquadResponse } from "./types";

const BASE_URL = "http://localhost:8000";

export async function fetchPlayers(): Promise<Player[]> {
  const res = await fetch(`${BASE_URL}/players`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch players");
  return res.json();
}

export async function generateSquad(req: SquadRequest): Promise<SquadResponse> {
  const res = await fetch(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Solver failed" }));
    throw new Error(err.detail ?? "Failed to generate squad");
  }
  return res.json();
}
