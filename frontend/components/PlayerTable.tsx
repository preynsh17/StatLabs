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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Sparkles } from "lucide-react";
import type { Player } from "@/lib/types";
import { POSITION_MAP } from "@/lib/types";
import { PlayerExplainSheet } from "./PlayerExplainSheet";
import { formatName } from "@/lib/format";

type SortKey = "price" | "adjusted_projection" | "gem_score_adj" | "std_fp_last_5";
type SortDir = "asc" | "desc";

const POSITION_COLORS: Record<number, string> = {
  0: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  1: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  2: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  3: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3 w-3 text-primary" />
    : <ArrowDown className="h-3 w-3 text-primary" />;
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
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search player or country..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-secondary border-border"
          />
        </div>
        <Select value={posFilter} onValueChange={(v) => setPosFilter(v ?? "all")}>
          <SelectTrigger className="w-full sm:w-44 bg-secondary border-border">
            <SelectValue placeholder="All Positions" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value="all">All Positions</SelectItem>
            <SelectItem value="0">Forwards (FWD)</SelectItem>
            <SelectItem value="1">Midfielders (MID)</SelectItem>
            <SelectItem value="3">Defenders (DEF)</SelectItem>
            <SelectItem value="2">Goalkeepers (GK)</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground self-center shrink-0 tabular-nums">
          {filtered.length} players
        </div>
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-primary" />
        Click any player to see their AI powered analytics breakdown
      </p>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-auto max-h-[580px] scrollbar-thin">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-10 text-center text-xs font-semibold">#</TableHead>
                <TableHead className="text-xs font-semibold">Player</TableHead>
                <TableHead className="text-xs font-semibold">Country</TableHead>
                <TableHead className="text-xs font-semibold">Pos</TableHead>
                <TableHead
                  className="text-xs font-semibold cursor-pointer select-none"
                  onClick={() => toggleSort("price")}
                >
                  <div className="flex items-center gap-1">
                    Price <SortIcon col="price" sortKey={sortKey} sortDir={sortDir} />
                  </div>
                </TableHead>
                <TableHead
                  className="text-xs font-semibold cursor-pointer select-none"
                  onClick={() => toggleSort("adjusted_projection")}
                >
                  <div className="flex items-center gap-1">
                    Proj Pts <SortIcon col="adjusted_projection" sortKey={sortKey} sortDir={sortDir} />
                  </div>
                </TableHead>
                <TableHead
                  className="text-xs font-semibold cursor-pointer select-none"
                  onClick={() => toggleSort("std_fp_last_5")}
                >
                  <div className="flex items-center gap-1">
                    Volatility <SortIcon col="std_fp_last_5" sortKey={sortKey} sortDir={sortDir} />
                  </div>
                </TableHead>
                <TableHead
                  className="text-xs font-semibold cursor-pointer select-none"
                  onClick={() => toggleSort("gem_score_adj")}
                >
                  <div className="flex items-center gap-1">
                    Gem Score <SortIcon col="gem_score_adj" sortKey={sortKey} sortDir={sortDir} />
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p, idx) => (
                <TableRow
                  key={`${p.player}-${p.country}`}
                  onClick={() => handleRowClick(p)}
                  className="border-border hover:bg-primary/5 cursor-pointer transition-colors group"
                >
                  <TableCell className="text-center text-sm text-muted-foreground font-mono">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="font-semibold text-sm group-hover:text-primary transition-colors">
                    {formatName(p.player)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono tracking-wider">
                    {p.country}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${POSITION_COLORS[p.position]}`}>
                      {POSITION_MAP[p.position]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-mono font-medium">
                    ${p.price.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-sm font-mono font-bold text-primary">
                    {p.adjusted_projection.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">
                    {p.std_fp_last_5.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-sm font-mono">
                    <span
                      className={
                        p.gem_score_adj > 3
                          ? "text-purple-400 font-bold"
                          : p.gem_score_adj > 1
                          ? "text-amber-400 font-semibold"
                          : "text-muted-foreground"
                      }
                    >
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
