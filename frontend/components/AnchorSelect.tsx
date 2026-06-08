"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
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

interface AnchorSelectProps {
  players: Player[];
  selected: string[];
  onChange: (anchors: string[]) => void;
  max?: number;
}

export function AnchorSelect({ players, selected, onChange, max = 3 }: AnchorSelectProps) {
  const [open, setOpen] = useState(false);

  const toggle = (name: string) => {
    if (selected.includes(name)) {
      onChange(selected.filter((s) => s !== name));
    } else if (selected.length < max) {
      onChange([...selected, name]);
    }
  };

  const remove = (name: string) => onChange(selected.filter((s) => s !== name));

  const playerMap = Object.fromEntries(players.map((p) => [p.player, p]));

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-expanded={open}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-secondary px-3 text-sm text-muted-foreground transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>
            {selected.length === 0
              ? "Search and add anchor players..."
              : `${selected.length} anchor${selected.length > 1 ? "s" : ""} selected`}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </PopoverTrigger>
        <PopoverContent className="w-[340px] p-0 bg-popover border-border" align="start">
          <Command className="bg-popover">
            <CommandInput
              placeholder="Search players..."
              className="border-0 border-b border-border rounded-none text-sm"
            />
            <CommandList className="max-h-64 scrollbar-thin">
              <CommandEmpty className="text-muted-foreground text-sm py-4 text-center">
                No player found.
              </CommandEmpty>
              <CommandGroup>
                {players.map((p) => {
                  const isSelected = selected.includes(p.player);
                  const disabled = !isSelected && selected.length >= max;
                  return (
                    <CommandItem
                      key={`${p.player}-${p.country}`}
                      value={p.player}
                      onSelect={() => !disabled && toggle(p.player)}
                      className={cn(
                        "flex items-center gap-2 cursor-pointer",
                        disabled && "opacity-40 cursor-not-allowed"
                      )}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 text-primary shrink-0",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="flex-1 text-sm">{formatName(p.player)}</span>
                      <span className="text-xs text-muted-foreground font-mono">{p.country}</span>
                      <Badge
                        variant="outline"
                        className={`text-xs ${POSITION_COLORS[p.position]}`}
                      >
                        {POSITION_MAP[p.position]}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono">
                        ${p.price.toFixed(1)}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((name) => {
            const p = playerMap[name];
            return (
              <Badge
                key={name}
                variant="outline"
                className="gap-1.5 pl-2.5 pr-1.5 py-1 bg-primary/10 border-primary/30 text-primary text-xs"
              >
                <span>{formatName(name)}</span>
                {p && (
                  <span className="text-primary/60">{POSITION_MAP[p.position]}</span>
                )}
                <button
                  onClick={() => remove(name)}
                  className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5 transition-colors"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
