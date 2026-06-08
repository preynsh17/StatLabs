"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Player } from "@/lib/types";
import { POSITION_MAP } from "@/lib/types";
import { formatName } from "@/lib/format";

const POSITION_COLORS: Record<number, string> = {
  0: "border-orange-500/40 bg-orange-500/10",
  1: "border-emerald-500/40 bg-emerald-500/10",
  2: "border-yellow-500/40 bg-yellow-500/10",
  3: "border-blue-500/40 bg-blue-500/10",
};

const POSITION_BADGE: Record<number, string> = {
  0: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  1: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  2: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  3: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function PlayerCard({ player, isBench = false }: { player: Player; isBench?: boolean }) {
  return (
    <div
      className={`
        flex flex-col items-center gap-1 rounded-lg border p-2 transition-all
        ${POSITION_COLORS[player.position]}
        ${isBench ? "opacity-60 scale-95" : ""}
        min-w-[80px] max-w-[100px] w-full
      `}
    >
      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${POSITION_BADGE[player.position]}`}>
        {POSITION_MAP[player.position]}
      </Badge>
      <p className="text-[11px] font-semibold text-center leading-tight line-clamp-2">{formatName(player.player)}</p>
      <div className="flex items-center gap-1 text-[10px]">
        <span className="text-primary font-mono font-bold">{player.adjusted_projection.toFixed(1)}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground font-mono">${player.price.toFixed(1)}</span>
      </div>
    </div>
  );
}

function PitchRow({
  players,
  label,
  isBench = false,
}: {
  players: Player[];
  label: string;
  isBench?: boolean;
}) {
  if (players.length === 0) return null;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
        {label}
      </span>
      <div className="flex justify-center gap-2 flex-wrap">
        {players.map((p) => (
          <PlayerCard key={`${p.player}-${p.country}`} player={p} isBench={isBench} />
        ))}
      </div>
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

  const costColor =
    totalCost > 99 ? "text-amber-400" : totalCost > 97 ? "text-emerald-400" : "text-emerald-400";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Total Cost</p>
            <p className={`text-2xl font-bold font-mono ${costColor}`}>
              ${totalCost.toFixed(1)}
              <span className="text-sm text-muted-foreground font-normal"> / 100.0</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Proj. Points</p>
            <p className="text-2xl font-bold font-mono text-primary">{totalPoints.toFixed(1)}</p>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Remaining: <span className="font-mono text-foreground">${(100 - totalCost).toFixed(1)}</span>
        </div>
      </div>

      {/* Pitch */}
      <div className="relative rounded-xl overflow-hidden border border-border">
        {/* Grass background */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent, transparent 40px, oklch(0.65 0.18 160) 40px, oklch(0.65 0.18 160) 42px)",
          }}
        />
        <div className="relative py-6 px-4 space-y-5">
          <PitchRow players={startingFWD} label="Forwards" />
          <PitchRow players={startingMID} label="Midfielders" />
          <PitchRow players={startingDEF} label="Defenders" />
          <PitchRow players={startingGK} label="Goalkeeper" />
        </div>
        {/* Centre circle hint */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none opacity-5">
          <div className="w-24 h-24 rounded-full border-2 border-primary" />
        </div>
      </div>

      <Separator className="bg-border/50" />

      {/* Bench */}
      <div>
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">Bench</p>
        <div className="flex gap-2 flex-wrap">
          {bench.map((p) => (
            <PlayerCard key={`${p.player}-${p.country}`} player={p} isBench />
          ))}
        </div>
      </div>
    </div>
  );
}
