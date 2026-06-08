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
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Player } from "@/lib/types";
import { POSITION_MAP } from "@/lib/types";
import { formatName } from "@/lib/format";

const POSITION_COLORS: Record<number, string> = {
  0: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  1: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  2: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  3: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

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

const COLOR_MAP: Record<string, { bar: string; badge: string; icon: string }> = {
  emerald: { bar: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: "text-emerald-400" },
  blue: { bar: "bg-blue-500", badge: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: "text-blue-400" },
  purple: { bar: "bg-purple-500", badge: "bg-purple-500/15 text-purple-400 border-purple-500/30", icon: "text-purple-400" },
  amber: { bar: "bg-amber-500", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: "text-amber-400" },
  sky: { bar: "bg-sky-500", badge: "bg-sky-500/15 text-sky-400 border-sky-500/30", icon: "text-sky-400" },
  orange: { bar: "bg-orange-500", badge: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: "text-orange-400" },
};

function percentileLabel(pct: number): string {
  if (pct >= 90) return "Elite";
  if (pct >= 75) return "Strong";
  if (pct >= 50) return "Above Avg";
  if (pct >= 25) return "Below Avg";
  return "Weak";
}

function FeatureBar({ feature }: { feature: Feature }) {
  const colors = COLOR_MAP[feature.color];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("shrink-0", colors.icon)}>{feature.icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none truncate">{feature.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{feature.description}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-mono font-bold">{feature.displayValue}</p>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 mt-0.5 ${colors.badge}`}>
            {feature.percentile}th · {percentileLabel(feature.percentile)}
          </Badge>
        </div>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
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
        <SheetHeader className="pb-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-xl font-bold leading-tight">{formatName(player.player)}</SheetTitle>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-sm text-muted-foreground font-mono">{player.country}</span>
                <Badge variant="outline" className={`text-xs ${POSITION_COLORS[player.position]}`}>
                  {POSITION_MAP[player.position]}
                </Badge>
                <span className="text-sm font-mono font-semibold text-primary">${player.price.toFixed(1)}</span>
              </div>
            </div>
          </div>

          {verdict && (
            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Info className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-bold text-primary uppercase tracking-wider">{verdict.label}</span>
              </div>
              <p className="text-sm text-muted-foreground leading-snug">{verdict.desc}</p>
            </div>
          )}
        </SheetHeader>

        <div className="px-4 pb-5 space-y-5">
          <Separator className="bg-border/50" />

          <div className="space-y-1">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Analytics Breakdown
            </h3>
            <p className="text-xs text-muted-foreground">
              Percentile rank vs {POSITION_MAP[player.position]} peers · Higher = better
            </p>
          </div>

          <div className="space-y-5">
            {features.map((f) => (
              <FeatureBar key={f.key} feature={f} />
            ))}
          </div>

          <Separator className="bg-border/50" />

          <div className="space-y-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Raw Stats</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Adj. Projection", value: player.adjusted_projection.toFixed(2) + " pts" },
                { label: "Price", value: `$${player.price.toFixed(1)}` },
                { label: "Gem Score", value: player.gem_score_adj.toFixed(2) },
                { label: "Form Volatility (σ)", value: player.std_fp_last_5.toFixed(2) },
                { label: "Points per $", value: (player.adjusted_projection / player.price).toFixed(3) },
                { label: "Captain Score", value: (player.adjusted_projection / (1 + player.std_fp_last_5)).toFixed(2) },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-secondary p-3">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-sm font-mono font-bold mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
