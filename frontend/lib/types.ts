export interface Player {
  player: string;
  country: string;
  position: number; // 0=FWD, 1=MID, 2=GK, 3=DEF
  price: number;
  adjusted_projection: number;
  std_fp_last_5: number;
  gem_score_adj: number;
}

export interface SingleSquad {
  squad: Player[];
  total_cost: number;
  total_points: number;
}

export interface SquadResponse extends SingleSquad {
  squads: SingleSquad[];
}

export interface SquadRequest {
  strategy: "meta" | "upside" | "value";
  anchors: string[];
  n_squads?: number;
}

export type Strategy = SquadRequest["strategy"];

export const POSITION_MAP: Record<number, string> = {
  0: "FWD",
  1: "MID",
  2: "GK",
  3: "DEF",
};

export const POSITION_ORDER = [2, 3, 1, 0]; // GK → DEF → MID → FWD
