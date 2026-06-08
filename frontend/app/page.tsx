import { fetchPlayers } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InsightCards } from "@/components/InsightCards";
import { PlayerTable } from "@/components/PlayerTable";
import { SquadGenerator } from "@/components/SquadGenerator";
import { BarChart2, Wand2, FlaskConical } from "lucide-react";
import type { Player } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let players: Player[] = [];
  let fetchError = false;

  try {
    players = await fetchPlayers();
  } catch {
    fetchError = true;
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary shadow-lg shadow-primary/30">
              <FlaskConical className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            <div>
              <p className="text-base font-extrabold tracking-tight leading-none">StatLabs</p>
              <p className="text-[11px] text-muted-foreground leading-none mt-0.5 tracking-wide">Find the edge before kickoff</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`h-1.5 w-1.5 rounded-full ${fetchError ? "bg-destructive" : "bg-primary animate-pulse"}`}
            />
            <span>{fetchError ? "API Offline" : `${players.length} players loaded`}</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {fetchError ? (
          <div className="flex flex-col items-center justify-center py-32 text-center gap-4">
            <div className="p-4 rounded-full bg-destructive/10">
              <FlaskConical className="h-10 w-10 text-destructive/60" />
            </div>
            <h2 className="text-xl font-semibold">Cannot connect to API</h2>
            <p className="text-muted-foreground text-sm max-w-sm">
              Make sure FastAPI is running on{" "}
              <code className="font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
                http://localhost:8000
              </code>
            </p>
          </div>
        ) : (
          <Tabs defaultValue="discover" className="space-y-6">
            <div className="flex items-center justify-between">
              <TabsList className="bg-secondary border border-border h-9">
                <TabsTrigger
                  value="discover"
                  className="text-xs gap-1.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <BarChart2 className="h-3.5 w-3.5" />
                  Data Discovery
                </TabsTrigger>
                <TabsTrigger
                  value="optimizer"
                  className="text-xs gap-1.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Squad Optimizer
                </TabsTrigger>
              </TabsList>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Budget: <span className="text-foreground font-mono font-semibold">$100.0</span> · 15 players · Max 3 per country
              </p>
            </div>

            {/* Tier 1: Data Discovery */}
            <TabsContent value="discover" className="space-y-6 mt-0">
              <div>
                <h1 className="text-xl font-bold tracking-tight">Data Discovery</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Explore the full player pool and surface the most valuable assets.
                </p>
              </div>
              <InsightCards players={players} />
              <div>
                <h2 className="text-base font-semibold mb-3">Master Player Pool</h2>
                <PlayerTable players={players} />
              </div>
            </TabsContent>

            {/* Tier 2: Squad Optimizer */}
            <TabsContent value="optimizer" className="mt-0">
              <div className="mb-6">
                <h1 className="text-xl font-bold tracking-tight">Squad Optimizer</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Pick a strategy, lock in anchors, and let the ILP solver find the optimal 15.
                </p>
              </div>
              <SquadGenerator players={players} />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
