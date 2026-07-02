import { fetchPlayers } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InsightCards } from "@/components/InsightCards";
import { PlayerTable } from "@/components/PlayerTable";
import { SquadGenerator } from "@/components/SquadGenerator";
import { BarChart2, Wand2, FlaskConical, Users, Globe, TrendingUp, Gem } from "lucide-react";
import type { Player } from "@/lib/types";
import { formatName } from "@/lib/format";

export const dynamic = "force-dynamic";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold leading-tight mt-0.5">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</p>
      </div>
    </div>
  );
}

export default async function Home() {
  let players: Player[] = [];
  let fetchError = false;

  try {
    players = await fetchPlayers();
  } catch {
    fetchError = true;
  }

  const nations = new Set(players.map((p) => p.country)).size;
  const medianPrice = median(players.map((p) => p.price));
  const topPlayer = players.reduce<Player | null>(
    (best, p) => (best === null || p.adjusted_projection > best.adjusted_projection ? p : best),
    null
  );
  const gemCount = players.filter((p) => p.gem_score_adj > 3).length;

  return (
    <Tabs defaultValue="discover" className="flex flex-col min-h-screen gap-0">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/75 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center justify-center h-8.5 w-8.5 rounded-lg bg-gradient-to-b from-primary to-primary/75 shadow-lg shadow-primary/25">
              <FlaskConical className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            <div className="hidden sm:block">
              <p className="text-[15px] font-extrabold tracking-tight leading-none">StatLabs</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-1 tracking-wide uppercase">
                World Cup 2026 · Analytics
              </p>
            </div>
          </div>

          <TabsList className="h-9 bg-secondary/70 border border-border/80 p-1">
            <TabsTrigger
              value="discover"
              className="text-xs gap-1.5 px-3 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              <BarChart2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Data Discovery</span>
              <span className="sm:hidden">Discover</span>
            </TabsTrigger>
            <TabsTrigger
              value="optimizer"
              className="text-xs gap-1.5 px-3 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Squad Optimizer</span>
              <span className="sm:hidden">Optimize</span>
            </TabsTrigger>
          </TabsList>

          <div className="hidden lg:flex items-center gap-2 shrink-0">
            <span className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] text-muted-foreground">
              Budget <span className="text-foreground font-semibold">$100.0</span>
            </span>
            <span className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] text-muted-foreground">
              15 players · max 3 / nation
            </span>
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                fetchError
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-primary/25 bg-primary/10 text-primary"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  fetchError ? "bg-destructive" : "bg-primary animate-pulse"
                }`}
              />
              {fetchError ? "API offline" : "Live data"}
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8">
        {fetchError ? (
          <div className="flex flex-col items-center justify-center py-32 text-center gap-4">
            <div className="p-4 rounded-2xl border border-destructive/20 bg-destructive/10">
              <FlaskConical className="h-9 w-9 text-destructive/70" />
            </div>
            <h2 className="text-xl font-semibold">Cannot connect to the API</h2>
            <p className="text-muted-foreground text-sm max-w-sm">
              Make sure FastAPI is running on{" "}
              <code className="font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
                http://localhost:8000
              </code>
            </p>
          </div>
        ) : (
          <>
            {/* Tier 1: Data Discovery */}
            <TabsContent value="discover" className="space-y-8 mt-0">
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Data Discovery</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Explore the full player pool and surface the most valuable assets before anyone else.
                  </p>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatTile
                    icon={<Users className="h-4 w-4" />}
                    label="Player pool"
                    value={String(players.length)}
                    hint={`${nations} nations covered`}
                  />
                  <StatTile
                    icon={<Globe className="h-4 w-4" />}
                    label="Median price"
                    value={`$${medianPrice.toFixed(1)}`}
                    hint="Across the full pool"
                  />
                  <StatTile
                    icon={<TrendingUp className="h-4 w-4" />}
                    label="Top projection"
                    value={topPlayer ? topPlayer.adjusted_projection.toFixed(1) : "—"}
                    hint={topPlayer ? formatName(topPlayer.player) : "No data"}
                  />
                  <StatTile
                    icon={<Gem className="h-4 w-4" />}
                    label="Hidden gems"
                    value={String(gemCount)}
                    hint="Gem score above 3.0"
                  />
                </div>
              </div>

              <InsightCards players={players} />

              <section className="space-y-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Master Player Pool</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Click any player for their full analytics breakdown.
                  </p>
                </div>
                <PlayerTable players={players} />
              </section>
            </TabsContent>

            {/* Tier 2: Squad Optimizer */}
            <TabsContent value="optimizer" className="mt-0">
              <div className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight">Squad Optimizer</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Pick a strategy, lock in anchors, and let the ILP solver find the optimal 15.
                </p>
              </div>
              <SquadGenerator players={players} />
            </TabsContent>
          </>
        )}
      </main>

      <footer className="border-t border-border/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>StatLabs · Find the edge before kickoff</span>
          <span className="hidden sm:block">ILP-optimised squads · 2026 World Cup</span>
        </div>
      </footer>
    </Tabs>
  );
}
