"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import type { Player } from "@/lib/types";
import { POSITION_MAP } from "@/lib/types";
import { POSITION_BADGE } from "@/lib/positions";
import { PlayerExplainSheet } from "./PlayerExplainSheet";
import { formatName } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "price" | "adjusted_projection" | "gem_score_adj" | "std_fp_last_5";
type SortDir = "asc" | "desc";

const POSITION_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "0", label: "FWD" },
  { value: "1", label: "MID" },
  { value: "3", label: "DEF" },
  { value: "2", label: "GK" },
];

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3 w-3 text-primary" />
    : <ArrowDown className="h-3 w-3 text-primary" />;
}

function SortableHead({
  col,
  label,
  sortKey,
  sortDir,
  onSort,
}: {
  col: SortKey;
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <TableHead
      className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none text-right"
      onClick={() => onSort(col)}
    >
      <div className="flex items-center justify-end gap-1">
        {label} <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
      </div>
    </TableHead>
  );
}

function gemTier(score: number): string {
  if (score > 3) return "bg-violet-400";
  if (score > 1) return "bg-amber-400";
  return "bg-muted-foreground/40";
}

interface PlayerTableProps {
  players: Player[];
}

export function PlayerTable({ players }: PlayerTableProps) {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("adjusted_projection");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const handleRowClick = (player: Player) => {
    setSelectedPlayer(player);
    setSheetOpen(true);
  };

  const filtered = useMemo(() => {
    return players
      .filter((p) => {
        const matchPos = posFilter === "all" || p.position === Number(posFilter);
        const matchSearch =
          search === "" ||
          p.player.toLowerCase().includes(search.toLowerCase()) ||
          p.country.toLowerCase().includes(search.toLowerCase());
        return matchPos && matchSearch;
      })
      .sort((a, b) => {
        const mul = sortDir === "asc" ? 1 : -1;
        return (a[sortKey] - b[sortKey]) * mul;
      });
  }, [players, posFilter, search, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search player or country..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-secondary/70 border-border rounded-lg"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/70 p-1">
          {POSITION_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setPosFilter(f.value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                posFilter === f.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums sm:ml-auto">
          {filtered.length} of {players.length} players
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-auto max-h-[580px] scrollbar-thin">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-popover">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-10 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  #
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Player
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Nation
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Pos
                </TableHead>
                <SortableHead col="price" label="Price" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHead col="adjusted_projection" label="Proj Pts" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHead col="std_fp_last_5" label="Volatility" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHead col="gem_score_adj" label="Gem Score" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p, idx) => (
                <TableRow
                  key={`${p.player}-${p.country}`}
                  onClick={() => handleRowClick(p)}
                  className="border-border/60 hover:bg-accent/50 cursor-pointer transition-colors group"
                >
                  <TableCell className="text-center text-xs text-muted-foreground font-mono tabular-nums">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="font-medium text-sm group-hover:text-primary transition-colors">
                    {formatName(p.player)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono tracking-wider">
                    {p.country}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] px-1.5 ${POSITION_BADGE[p.position]}`}>
                      {POSITION_MAP[p.position]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-right">
                    ${p.price.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums font-semibold text-right">
                    {p.adjusted_projection.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-muted-foreground text-right">
                    {p.std_fp_last_5.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center justify-end gap-1.5 text-sm font-mono tabular-nums">
                      <span className={`h-1.5 w-1.5 rounded-full ${gemTier(p.gem_score_adj)}`} />
                      {p.gem_score_adj.toFixed(2)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-16 text-sm">
                    No players match your search.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
          <span>Gem score tiers:</span>
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> Elite (&gt;3)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Strong (&gt;1)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" /> Standard
            </span>
          </span>
        </div>
      </div>

      <PlayerExplainSheet
        player={selectedPlayer}
        allPlayers={players}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}
