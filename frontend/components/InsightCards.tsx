"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Zap, TrendingUp } from "lucide-react";
import type { Player } from "@/lib/types";
import { POSITION_MAP } from "@/lib/types";
import { POSITION_BADGE } from "@/lib/positions";
import { formatName } from "@/lib/format";

type RankedPlayer = Player & { _value: string };

function InsightRow({
  player,
  rank,
  valueLabel,
  unit,
}: {
  player: RankedPlayer;
  rank: number;
  valueLabel: string;
  unit: string;
}) {
  const isTop = rank === 1;
  return (
    <div
      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 -mx-2.5 transition-colors hover:bg-accent/60 ${
        isTop ? "bg-primary/[0.06]" : ""
      }`}
    >
      <span
        className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold font-mono ${
          isTop
            ? "bg-primary/15 text-primary"
            : "bg-secondary text-muted-foreground"
        }`}
      >
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate leading-tight">{formatName(player.player)}</p>
        <p className="text-[11px] text-muted-foreground font-mono tracking-wide mt-0.5">
          {player.country} · ${player.price.toFixed(1)}
        </p>
      </div>
      <Badge
        variant="outline"
        className={`text-[10px] px-1.5 shrink-0 ${POSITION_BADGE[player.position]}`}
      >
        {POSITION_MAP[player.position]}
      </Badge>
      <div className="text-right shrink-0 w-14">
        <p className="text-sm font-semibold font-mono tabular-nums leading-tight">{valueLabel}</p>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{unit}</p>
      </div>
    </div>
  );
}

function InsightCard({
  icon,
  iconClass,
  title,
  subtitle,
  rows,
  unit,
}: {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  subtitle: string;
  rows: RankedPlayer[];
  unit: string;
}) {
  return (
    <Card className="bg-card border-border gap-4">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
          <div className={`flex h-7.5 w-7.5 items-center justify-center rounded-lg ${iconClass}`}>
            {icon}
          </div>
          <div>
            <p className="leading-none">{title}</p>
            <p className="text-[11px] text-muted-foreground font-normal mt-1 leading-none">
              {subtitle}
            </p>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-0.5">
        {rows.map((p, i) => (
          <InsightRow
            key={`${p.player}-${p.country}`}
            player={p}
            rank={i + 1}
            valueLabel={p._value}
            unit={unit}
          />
        ))}
      </CardContent>
    </Card>
  );
}

interface InsightCardsProps {
  players: Player[];
}

export function InsightCards({ players }: InsightCardsProps) {
  const { safeCaptains, highUpside, topProjected } = useMemo(() => {
    const safeCaptains: RankedPlayer[] = [...players]
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

    const highUpside: RankedPlayer[] = [...players]
      .sort((a, b) => b.gem_score_adj - a.gem_score_adj)
      .slice(0, 5)
      .map((p) => ({ ...p, _value: p.gem_score_adj.toFixed(2) }));

    const topProjected: RankedPlayer[] = [...players]
      .sort((a, b) => b.adjusted_projection - a.adjusted_projection)
      .slice(0, 5)
      .map((p) => ({ ...p, _value: p.adjusted_projection.toFixed(2) }));

    return { safeCaptains, highUpside, topProjected };
  }, [players]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <InsightCard
        icon={<Shield className="h-3.5 w-3.5" />}
        iconClass="bg-sky-500/12 text-sky-400"
        title="Top Safe Captains"
        subtitle="Projection / (1 + volatility)"
        rows={safeCaptains}
        unit="score"
      />
      <InsightCard
        icon={<Zap className="h-3.5 w-3.5" />}
        iconClass="bg-violet-500/12 text-violet-400"
        title="High Upside Differentials"
        subtitle="Sorted by gem score"
        rows={highUpside}
        unit="gem"
      />
      <InsightCard
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        iconClass="bg-primary/12 text-primary"
        title="Top Projected Overall"
        subtitle="Raw adjusted projection"
        rows={topProjected}
        unit="pts"
      />
    </div>
  );
}
