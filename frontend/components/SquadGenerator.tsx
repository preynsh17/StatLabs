"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Shield, Rocket, Gem, Loader2, AlertCircle, Layers, Check } from "lucide-react";
import { toast } from "sonner";
import { AnchorSelect } from "./AnchorSelect";
import { SquadPitch } from "./SquadPitch";
import { generateSquad } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Player, SquadResponse, Strategy, SingleSquad } from "@/lib/types";

const STRATEGIES: { id: Strategy; icon: React.ReactNode; label: string; desc: string }[] = [
  {
    id: "meta",
    icon: <Shield className="h-4 w-4" />,
    label: "The Meta",
    desc: "Highest expected points",
  },
  {
    id: "upside",
    icon: <Rocket className="h-4 w-4" />,
    label: "High Upside",
    desc: "Tournament-winner volatility",
  },
  {
    id: "value",
    icon: <Gem className="h-4 w-4" />,
    label: "Differential Value",
    desc: "Points per million + gems",
  },
];

const SQUAD_COUNT_OPTIONS = [1, 2, 3, 5];

interface SquadGeneratorProps {
  players: Player[];
}

function StepLabel({ step, label, aside }: { step: string; label: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <span className="flex h-4.5 w-4.5 items-center justify-center rounded bg-secondary font-mono text-[10px] text-foreground/70">
          {step}
        </span>
        {label}
      </p>
      {aside}
    </div>
  );
}

function PitchSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex gap-4">
        <Skeleton className="h-16 w-32 rounded-xl" />
        <Skeleton className="h-16 w-32 rounded-xl" />
        <Skeleton className="h-16 w-32 rounded-xl" />
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
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
          {squads.length} alternatives generated
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
    <div className="grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-5 items-start">
      {/* Control Panel */}
      <Card className="bg-card border-border lg:sticky lg:top-20 py-5">
        <CardContent className="space-y-6 px-5">
          {/* Strategy selector */}
          <div className="space-y-2.5">
            <StepLabel step="1" label="Strategy" />
            <div className="space-y-2">
              {STRATEGIES.map((s) => {
                const active = strategy === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setStrategy(s.id)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-all",
                      active
                        ? "border-primary/40 bg-primary/[0.07]"
                        : "border-border bg-secondary/40 hover:bg-secondary/80"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                        active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {s.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-semibold leading-none", !active && "text-foreground/80")}>
                        {s.label}
                      </p>
                      <p className="text-xs mt-1 text-muted-foreground leading-none">{s.desc}</p>
                    </div>
                    <span
                      className={cn(
                        "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border transition-all",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-transparent"
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Anchor selector */}
          <div className="space-y-2.5">
            <StepLabel
              step="2"
              label="Must-Have Anchors"
              aside={
                <span className="text-[11px] text-muted-foreground font-mono">
                  {anchors.length}/11
                </span>
              }
            />
            <AnchorSelect players={players} selected={anchors} onChange={setAnchors} max={11} />
          </div>

          {/* Squad count */}
          <div className="space-y-2.5">
            <StepLabel step="3" label="Alternative Squads" />
            <div className="flex gap-1.5">
              {SQUAD_COUNT_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setNSquads(n)}
                  className={cn(
                    "flex-1 rounded-md border py-1.5 text-sm font-semibold transition-all",
                    nSquads === n
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {n === 1 ? "1" : `×${n}`}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {nSquads === 1
                ? "Single optimal squad"
                : `${nSquads} diverse squads — each differs by 4+ players`}
            </p>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full h-10 font-semibold bg-gradient-to-b from-primary to-primary/85 text-primary-foreground hover:from-primary/95 hover:to-primary/80 shadow-lg shadow-primary/20 transition-all"
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
      <Card className="bg-card border-border py-5">
        <CardContent className="px-5">
          {loading && <PitchSkeleton />}
          {!loading && !result && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24 text-center text-muted-foreground gap-3 m-1">
              <div className="p-4 rounded-2xl bg-primary/10">
                <Sparkles className="h-7 w-7 text-primary/70" />
              </div>
              <p className="text-sm font-semibold text-foreground">No squad generated yet</p>
              <p className="text-xs max-w-xs leading-relaxed">
                Select a strategy, optionally lock in anchor players, then hit Optimise to run the
                ILP solver against the full player pool.
              </p>
            </div>
          )}
          {!loading && result && (
            <MultiSquadDisplay
              squads={
                result.squads ?? [
                  { squad: result.squad, total_cost: result.total_cost, total_points: result.total_points },
                ]
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
