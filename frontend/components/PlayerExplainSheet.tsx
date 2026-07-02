"use client";

import { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  TrendingUp,
  Shield,
  Gem,
  DollarSign,
  Target,
  Star,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Player } from "@/lib/types";
import { POSITION_MAP } from "@/lib/types";
import { POSITION_BADGE } from "@/lib/positions";
import { formatName } from "@/lib/format";

interface Feature {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  value: number;
  displayValue: string;
  percentile: number;
  color: string;
}

function percentileOf(value: number, values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.filter((v) => v <= value).length;
  return Math.round((rank / sorted.length) * 100);
}

function computeFeatures(player: Player, pool: Player[]): Feature[] {
  const positionPeers = pool.filter((p) => p.position === player.position);
  const peers = positionPeers.length >= 5 ? positionPeers : pool;

  const projections = peers.map((p) => p.adjusted_projection);
  const volatilities = peers.map((p) => p.std_fp_last_5);
  const gemScores = peers.map((p) => p.gem_score_adj);
  const efficiencies = peers.map((p) =>
    p.price > 0 ? p.adjusted_projection / p.price : 0
  );
  const captainScores = peers.map((p) => p.adjusted_projection / (1 + p.std_fp_last_5));
  const floorScores = peers.map((p) =>
    Math.max(0, p.adjusted_projection - p.std_fp_last_5)
  );

  const efficiency = player.price > 0 ? player.adjusted_projection / player.price : 0;
  const captainScore = player.adjusted_projection / (1 + player.std_fp_last_5);
  const floorScore = Math.max(0, player.adjusted_projection - player.std_fp_last_5);
  // Consistency is the inverse of volatility — lower std = higher consistency percentile
  const consistencyPctile = 100 - percentileOf(player.std_fp_last_5, volatilities);

  return [
    {
      key: "projection",
      label: "Projected Points",
      description: "AI adjusted fantasy points forecast vs position peers",
      icon: <TrendingUp className="h-4 w-4" />,
      value: player.adjusted_projection,
      displayValue: player.adjusted_projection.toFixed(2) + " pts",
      percentile: percentileOf(player.adjusted_projection, projections),
      color: "emerald",
    },
    {
      key: "captain",
      label: "Captain Score",
      description: "Proj / (1 + Volatility) — risk adjusted output for captaincy",
      icon: <Star className="h-4 w-4" />,
      value: captainScore,
      displayValue: captainScore.toFixed(2),
      percentile: percentileOf(captainScore, captainScores),
      color: "blue",
    },
    {
      key: "gem",
      label: "Gem Value",
      description: "Proprietary score identifying underpriced assets vs the market",
      icon: <Gem className="h-4 w-4" />,
      value: player.gem_score_adj,
      displayValue: player.gem_score_adj.toFixed(2),
      percentile: percentileOf(player.gem_score_adj, gemScores),
      color: "purple",
    },
    {
      key: "efficiency",
      label: "Cost Efficiency",
      description: "Points per dollar — essential for budget constrained squads",
      icon: <DollarSign className="h-4 w-4" />,
      value: efficiency,
      displayValue: efficiency.toFixed(3) + " pts/$",
      percentile: percentileOf(efficiency, efficiencies),
      color: "amber",
    },
    {
      key: "consistency",
      label: "Consistency",
      description: "Inverse of form volatility — lower std deviation = higher score",
      icon: <Shield className="h-4 w-4" />,
      value: player.std_fp_last_5,
      displayValue: `σ ${player.std_fp_last_5.toFixed(2)}`,
      percentile: consistencyPctile,
      color: "sky",
    },
    {
      key: "floor",
      label: "Scoring Floor",
      description: "Expected minimum output — projection minus one std deviation",
      icon: <Target className="h-4 w-4" />,
      value: floorScore,
      displayValue: floorScore.toFixed(2) + " pts",
      percentile: percentileOf(floorScore, floorScores),
      color: "orange",
    },
  ];
}

// Meter spec: the fill carries the value; the track is a lighter step of the same hue.
const COLOR_MAP: Record<string, { bar: string; track: string; icon: string }> = {
  emerald: { bar: "bg-emerald-400", track: "bg-emerald-400/15", icon: "bg-emerald-400/12 text-emerald-400" },
  blue: { bar: "bg-blue-400", track: "bg-blue-400/15", icon: "bg-blue-400/12 text-blue-400" },
  purple: { bar: "bg-violet-400", track: "bg-violet-400/15", icon: "bg-violet-400/12 text-violet-400" },
  amber: { bar: "bg-amber-400", track: "bg-amber-400/15", icon: "bg-amber-400/12 text-amber-400" },
  sky: { bar: "bg-sky-400", track: "bg-sky-400/15", icon: "bg-sky-400/12 text-sky-400" },
  orange: { bar: "bg-orange-400", track: "bg-orange-400/15", icon: "bg-orange-400/12 text-orange-400" },
};

function percentileLabel(pct: number): string {
  if (pct >= 90) return "Elite";
  if (pct >= 75) return "Strong";
  if (pct >= 50) return "Above avg";
  if (pct >= 25) return "Below avg";
  return "Weak";
}

function FeatureBar({ feature }: { feature: Feature }) {
  const colors = COLOR_MAP[feature.color];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", colors.icon)}>
            {feature.icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none truncate">{feature.label}</p>
            <p className="text-[11px] text-muted-foreground mt-1 truncate">{feature.description}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-mono tabular-nums font-semibold">{feature.displayValue}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {feature.percentile}th · {percentileLabel(feature.percentile)}
          </p>
        </div>
      </div>
      <div className={cn("relative h-1.5 rounded-full overflow-hidden", colors.track)}>
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all", colors.bar)}
          style={{ width: `${feature.percentile}%` }}
        />
      </div>
    </div>
  );
}

function overallVerdict(features: Feature[]): { label: string; desc: string } {
  const avgPct = features.reduce((s, f) => s + f.percentile, 0) / features.length;
  if (avgPct >= 75) return { label: "Premium Asset", desc: "Ranks in the elite tier across multiple dimensions — worth building your squad around." };
  if (avgPct >= 60) return { label: "Solid Pick", desc: "Consistently above average across key metrics. Good value within budget." };
  if (avgPct >= 45) return { label: "Situational", desc: "Mixed profile. Best used as a differential or to plug a specific gap." };
  return { label: "Budget Filler", desc: "Below-average metrics. Only include for budget management or anchoring purposes." };
}

interface PlayerExplainSheetProps {
  player: Player | null;
  allPlayers: Player[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlayerExplainSheet({ player, allPlayers, open, onOpenChange }: PlayerExplainSheetProps) {
  const features = useMemo(() => {
    if (!player) return [];
    return computeFeatures(player, allPlayers);
  }, [player, allPlayers]);

  const verdict = useMemo(() => {
    if (features.length === 0) return null;
    return overallVerdict(features);
  }, [features]);

  if (!player) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[460px] bg-card border-border overflow-y-auto scrollbar-thin">
        <SheetHeader className="pb-2">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-xl font-bold leading-tight">
                {formatName(player.player)}
              </SheetTitle>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-muted-foreground font-mono tracking-wider">
                  {player.country}
                </span>
                <Badge variant="outline" className={`text-[10px] px-1.5 ${POSITION_BADGE[player.position]}`}>
                  {POSITION_MAP[player.position]}
                </Badge>
                <span className="text-xs font-mono font-semibold rounded-md bg-secondary px-1.5 py-0.5">
                  ${player.price.toFixed(1)}
                </span>
              </div>
            </div>
          </div>

          {verdict && (
            <div className="mt-3 rounded-xl border border-primary/25 bg-gradient-to-b from-primary/[0.09] to-primary/[0.04] p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-bold text-primary uppercase tracking-wider">
                  {verdict.label}
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-snug">{verdict.desc}</p>
            </div>
          )}
        </SheetHeader>

        <div className="px-4 pb-6 space-y-5">
          <Separator className="bg-border/50" />

          <div className="space-y-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Analytics Breakdown
            </h3>
            <p className="text-xs text-muted-foreground">
              Percentile rank vs {POSITION_MAP[player.position]} peers · higher is better
            </p>
          </div>

          <div className="space-y-5">
            {features.map((f) => (
              <FeatureBar key={f.key} feature={f} />
            ))}
          </div>

          <Separator className="bg-border/50" />

          <div className="space-y-2.5">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Raw Stats
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Adj. projection", value: player.adjusted_projection.toFixed(2) + " pts" },
                { label: "Price", value: `$${player.price.toFixed(1)}` },
                { label: "Gem score", value: player.gem_score_adj.toFixed(2) },
                { label: "Form volatility (σ)", value: player.std_fp_last_5.toFixed(2) },
                { label: "Points per $", value: (player.adjusted_projection / player.price).toFixed(3) },
                { label: "Captain score", value: (player.adjusted_projection / (1 + player.std_fp_last_5)).toFixed(2) },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border/60 bg-secondary/50 p-3">
                  <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  <p className="text-sm font-mono tabular-nums font-semibold mt-1">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
