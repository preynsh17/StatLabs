"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Shield, Rocket, Gem, Loader2, AlertCircle, Layers } from "lucide-react";
import { toast } from "sonner";
import { AnchorSelect } from "./AnchorSelect";
import { SquadPitch } from "./SquadPitch";
import { generateSquad } from "@/lib/api";
import type { Player, SquadResponse, Strategy, SingleSquad } from "@/lib/types";

const STRATEGIES: { id: Strategy; icon: React.ReactNode; label: string; desc: string; color: string }[] = [
  {
    id: "meta",
    icon: <Shield className="h-4 w-4" />,
    label: "The Meta",
    desc: "Highest Expected Points",
    color: "border-blue-500/40 bg-blue-500/10 text-blue-400",
  },
  {
    id: "upside",
    icon: <Rocket className="h-4 w-4" />,
    label: "High Upside",
    desc: "Tournament Winner Volatility",
    color: "border-purple-500/40 bg-purple-500/10 text-purple-400",
  },
  {
    id: "value",
    icon: <Gem className="h-4 w-4" />,
    label: "Differential Value",
    desc: "Points per Million + Gems",
    color: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  },
];

const SQUAD_COUNT_OPTIONS = [1, 2, 3, 5];

interface SquadGeneratorProps {
  players: Player[];
}

function PitchSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex gap-8">
        <Skeleton className="h-12 w-28" />
        <Skeleton className="h-12 w-28" />
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-24 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function MultiSquadDisplay({ squads }: { squads: SingleSquad[] }) {
  if (squads.length === 1) {
    return (
      <SquadPitch
        squad={squads[0].squad}
        totalCost={squads[0].total_cost}
        totalPoints={squads[0].total_points}
      />
    );
  }

  return (
    <Tabs defaultValue="0">
      <div className="flex items-center gap-3 mb-4">
        <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
        <TabsList className="bg-secondary border border-border h-8 flex-wrap gap-1">
          {squads.map((_, i) => (
            <TabsTrigger
              key={i}
              value={String(i)}
              className="text-xs h-6 px-3 data-[state=active]:bg-card data-[state=active]:text-foreground"
            >
              Squad {i + 1}
            </TabsTrigger>
          ))}
        </TabsList>
        <span className="text-xs text-muted-foreground ml-auto">
          {squads.length} alternative{squads.length > 1 ? "s" : ""} generated
        </span>
      </div>
      {squads.map((s, i) => (
        <TabsContent key={i} value={String(i)} className="mt-0">
          <SquadPitch squad={s.squad} totalCost={s.total_cost} totalPoints={s.total_points} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function SquadGenerator({ players }: SquadGeneratorProps) {
  const [strategy, setStrategy] = useState<Strategy>("meta");
  const [anchors, setAnchors] = useState<string[]>([]);
  const [nSquads, setNSquads] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SquadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await generateSquad({ strategy, anchors, n_squads: nSquads });
      setResult(res);
      const count = res.squads?.length ?? 1;
      toast.success(
        count > 1 ? `${count} squads generated` : "Squad optimised successfully!",
        {
          description: `$${res.total_cost.toFixed(1)} · ${res.total_points.toFixed(1)} projected points`,
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unknown error occurred";
      setError(msg);
      toast.error("Solver failed", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
      {/* Control Panel */}
      <Card className="bg-card border-border lg:sticky lg:top-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Optimization Engine
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Strategy selector */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Strategy
            </p>
            <div className="space-y-2">
              {STRATEGIES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStrategy(s.id)}
                  className={`
                    w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-all
                    ${
                      strategy === s.id
                        ? s.color + " shadow-sm"
                        : "border-border bg-secondary/50 text-muted-foreground hover:bg-secondary"
                    }
                  `}
                >
                  <span className={strategy === s.id ? "" : "opacity-50"}>{s.icon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-none">{s.label}</p>
                    <p className="text-xs mt-0.5 opacity-70">{s.desc}</p>
                  </div>
                  {strategy === s.id && (
                    <div className="ml-auto h-2 w-2 rounded-full bg-current shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <Separator className="bg-border/50" />

          {/* Anchor selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Must Have Anchors
              </p>
              <span className="text-xs text-muted-foreground font-mono">
                {anchors.length}/11
              </span>
            </div>
            <AnchorSelect players={players} selected={anchors} onChange={setAnchors} max={11} />
          </div>

          <Separator className="bg-border/50" />

          {/* Squad count */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Alternative Squads
            </p>
            <div className="flex gap-1.5">
              {SQUAD_COUNT_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setNSquads(n)}
                  className={`
                    flex-1 rounded-md border py-1.5 text-sm font-semibold transition-all
                    ${
                      nSquads === n
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-secondary/50 text-muted-foreground hover:bg-secondary"
                    }
                  `}
                >
                  {n === 1 ? "1" : `×${n}`}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {nSquads === 1
                ? "Single optimal squad"
                : `${nSquads} diverse squads — each differs by 4+ players`}
            </p>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold h-10 transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Optimising{nSquads > 1 ? ` ${nSquads} squads` : ""}...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                {nSquads > 1 ? `Generate ${nSquads} Squads` : "Optimise Squad"}
              </>
            )}
          </Button>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Output */}
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          {loading && <PitchSkeleton />}
          {!loading && !result && (
            <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
              <div className="p-4 rounded-full bg-primary/10">
                <Sparkles className="h-8 w-8 text-primary/60" />
              </div>
              <p className="text-sm font-semibold">No squad generated yet</p>
              <p className="text-xs max-w-xs">
                Select a strategy, optionally lock in anchor players, then hit Optimise to run the solver.
              </p>
            </div>
          )}
          {!loading && result && (
            <MultiSquadDisplay squads={result.squads ?? [{ squad: result.squad, total_cost: result.total_cost, total_points: result.total_points }]} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
