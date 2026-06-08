"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Zap, TrendingUp } from "lucide-react";
import type { Player } from "@/lib/types";
import { POSITION_MAP } from "@/lib/types";
import { formatName } from "@/lib/format";

const POSITION_COLORS: Record<number, string> = {
  0: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  1: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  2: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  3: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function InsightRow({ player, rank, valueLabel }: { player: Player; rank: number; valueLabel: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground w-4 text-center font-mono">{rank}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{formatName(player.player)}</p>
        <p className="text-xs text-muted-foreground">{player.country}</p>
      </div>
      <Badge variant="outline" className={`text-xs shrink-0 ${POSITION_COLORS[player.position]}`}>
        {POSITION_MAP[player.position]}
      </Badge>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-primary font-mono">{valueLabel}</p>
        <p className="text-xs text-muted-foreground">${player.price.toFixed(1)}</p>
      </div>
    </div>
  );
}

interface InsightCardsProps {
  players: Player[];
}

export function InsightCards({ players }: InsightCardsProps) {
  const { safeCaptains, highUpside, topProjected } = useMemo(() => {
    const sorted = [...players];

    const safeCaptains = [...sorted]
      .sort((a, b) => {
        const scoreA = a.adjusted_projection / (1 + a.std_fp_last_5);
        const scoreB = b.adjusted_projection / (1 + b.std_fp_last_5);
        return scoreB - scoreA;
      })
      .slice(0, 5)
      .map((p) => ({
        ...p,
        _value: (p.adjusted_projection / (1 + p.std_fp_last_5)).toFixed(2),
      }));

    const highUpside = [...sorted]
      .sort((a, b) => b.gem_score_adj - a.gem_score_adj)
      .slice(0, 5)
      .map((p) => ({ ...p, _value: p.gem_score_adj.toFixed(2) }));

    const topProjected = [...sorted]
      .sort((a, b) => b.adjusted_projection - a.adjusted_projection)
      .slice(0, 5)
      .map((p) => ({ ...p, _value: p.adjusted_projection.toFixed(2) }));

    return { safeCaptains, highUpside, topProjected };
  }, [players]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <div className="p-1.5 rounded-md bg-blue-500/15">
              <Shield className="h-3.5 w-3.5 text-blue-400" />
            </div>
            Top Safe Captains
          </CardTitle>
          <p className="text-xs text-muted-foreground">Projection / (1 + Volatility)</p>
        </CardHeader>
        <CardContent className="pt-0">
          {safeCaptains.map((p, i) => (
            <InsightRow key={`${p.player}-${p.country}`} player={p} rank={i + 1} valueLabel={`${p._value} pts`} />
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <div className="p-1.5 rounded-md bg-purple-500/15">
              <Zap className="h-3.5 w-3.5 text-purple-400" />
            </div>
            High Upside Differentials
          </CardTitle>
          <p className="text-xs text-muted-foreground">Sorted by Gem Score</p>
        </CardHeader>
        <CardContent className="pt-0">
          {highUpside.map((p, i) => (
            <InsightRow key={`${p.player}-${p.country}`} player={p} rank={i + 1} valueLabel={`${p._value} gem`} />
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <div className="p-1.5 rounded-md bg-emerald-500/15">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            Top Projected Overall
          </CardTitle>
          <p className="text-xs text-muted-foreground">Raw Adjusted Projection</p>
        </CardHeader>
        <CardContent className="pt-0">
          {topProjected.map((p, i) => (
            <InsightRow key={`${p.player}-${p.country}`} player={p} rank={i + 1} valueLabel={`${p._value} pts`} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
