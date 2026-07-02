"use client";

import { useMemo } from "react";
import type { Player } from "@/lib/types";
import { POSITION_MAP } from "@/lib/types";
import { POSITION_TEXT, POSITION_DOT } from "@/lib/positions";
import { formatName } from "@/lib/format";
import { cn } from "@/lib/utils";

function PlayerCard({ player, isBench = false }: { player: Player; isBench?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border border-border/80 bg-card/90 backdrop-blur-sm px-2 py-2 shadow-sm",
        "min-w-[84px] max-w-[104px] w-full transition-colors hover:border-border",
        isBench && "opacity-70 bg-secondary/60"
      )}
    >
      <span className={cn("flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest", POSITION_TEXT[player.position])}>
        <span className={cn("h-1 w-1 rounded-full", POSITION_DOT[player.position])} />
        {POSITION_MAP[player.position]}
      </span>
      <p className="text-[11px] font-semibold text-center leading-tight line-clamp-2">
        {formatName(player.player)}
      </p>
      <div className="flex items-center gap-1 text-[10px] font-mono tabular-nums">
        <span className="font-bold">{player.adjusted_projection.toFixed(1)}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">${player.price.toFixed(1)}</span>
      </div>
    </div>
  );
}

function PitchRow({ players }: { players: Player[] }) {
  if (players.length === 0) return null;
  return (
    <div className="flex justify-center gap-2 sm:gap-3 flex-wrap">
      {players.map((p) => (
        <PlayerCard key={`${p.player}-${p.country}`} player={p} />
      ))}
    </div>
  );
}

function splitSquad(squad: Player[]) {
  const gks = squad.filter((p) => p.position === 2).sort((a, b) => b.price - a.price);
  const outfield = squad.filter((p) => p.position !== 2).sort((a, b) => b.price - a.price);

  const benchGK = gks.length > 1 ? [gks[gks.length - 1]] : [];
  const startingGK = gks.length > 0 ? [gks[0]] : [];

  const benchOutfield = outfield.slice(outfield.length - 3);
  const startingOutfield = outfield.slice(0, outfield.length - 3);

  const startingDEF = startingOutfield.filter((p) => p.position === 3);
  const startingMID = startingOutfield.filter((p) => p.position === 1);
  const startingFWD = startingOutfield.filter((p) => p.position === 0);

  return {
    startingGK,
    startingDEF,
    startingMID,
    startingFWD,
    bench: [...benchGK, ...benchOutfield],
  };
}

/** White hairline pitch markings, drawn once as absolutely-positioned chrome. */
function PitchMarkings() {
  const line = "border-white/[0.08]";
  return (
    <div className="absolute inset-3 pointer-events-none" aria-hidden>
      {/* Touchline */}
      <div className={cn("absolute inset-0 rounded-sm border", line)} />
      {/* Halfway line */}
      <div className={cn("absolute inset-x-0 top-1/2 border-t", line)} />
      {/* Centre circle */}
      <div
        className={cn(
          "absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border",
          line
        )}
      />
      {/* Penalty boxes */}
      <div className={cn("absolute left-1/2 top-0 h-14 w-44 -translate-x-1/2 border-x border-b rounded-b-sm", line)} />
      <div className={cn("absolute left-1/2 bottom-0 h-14 w-44 -translate-x-1/2 border-x border-t rounded-t-sm", line)} />
      {/* Six-yard boxes */}
      <div className={cn("absolute left-1/2 top-0 h-6 w-20 -translate-x-1/2 border-x border-b", line)} />
      <div className={cn("absolute left-1/2 bottom-0 h-6 w-20 -translate-x-1/2 border-x border-t", line)} />
    </div>
  );
}

interface SquadPitchProps {
  squad: Player[];
  totalCost: number;
  totalPoints: number;
}

export function SquadPitch({ squad, totalCost, totalPoints }: SquadPitchProps) {
  const { startingGK, startingDEF, startingMID, startingFWD, bench } = useMemo(
    () => splitSquad(squad),
    [squad]
  );

  const budgetPct = Math.min(100, (totalCost / 100) * 100);
  const remaining = 100 - totalCost;

  return (
    <div className="space-y-5">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-primary/25 bg-primary/[0.07] p-4">
          <p className="text-xs text-muted-foreground">Projected points</p>
          <p className="text-2xl font-bold text-primary mt-1 leading-none">
            {totalPoints.toFixed(1)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-secondary/40 p-4">
          <p className="text-xs text-muted-foreground">Total cost</p>
          <p className="text-2xl font-bold mt-1 leading-none">
            ${totalCost.toFixed(1)}
            <span className="text-sm text-muted-foreground font-normal"> / 100</span>
          </p>
          <div className="relative mt-2.5 h-1.5 rounded-full bg-primary/15 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-secondary/40 p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-muted-foreground">Budget remaining</p>
          <p className="text-2xl font-bold mt-1 leading-none">${remaining.toFixed(1)}</p>
        </div>
      </div>

      {/* Pitch */}
      <div
        className="relative rounded-xl overflow-hidden border border-border"
        style={{
          background: "linear-gradient(180deg, oklch(0.17 0.035 155), oklch(0.14 0.03 155))",
        }}
      >
        {/* Mowing stripes */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, oklch(1 0 0 / 0.02) 0 48px, transparent 48px 96px)",
          }}
        />
        <PitchMarkings />
        <div className="relative py-8 px-4 flex flex-col gap-7">
          <PitchRow players={startingFWD} />
          <PitchRow players={startingMID} />
          <PitchRow players={startingDEF} />
          <PitchRow players={startingGK} />
        </div>
      </div>

      {/* Bench */}
      <div className="rounded-xl border border-border bg-secondary/30 p-4">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Bench
        </p>
        <div className="flex gap-2 flex-wrap">
          {bench.map((p) => (
            <PlayerCard key={`${p.player}-${p.country}`} player={p} isBench />
          ))}
        </div>
      </div>
    </div>
  );
}
