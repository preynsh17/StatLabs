// Single source of truth for position color coding.
// Hues chosen for CVD separation and to stay clear of the emerald brand accent:
// FWD rose · MID violet · GK amber · DEF sky.

export const POSITION_BADGE: Record<number, string> = {
  0: "bg-rose-500/10 text-rose-400 border-rose-500/25",
  1: "bg-violet-500/10 text-violet-400 border-violet-500/25",
  2: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  3: "bg-sky-500/10 text-sky-400 border-sky-500/25",
};

export const POSITION_DOT: Record<number, string> = {
  0: "bg-rose-400",
  1: "bg-violet-400",
  2: "bg-amber-400",
  3: "bg-sky-400",
};

export const POSITION_TEXT: Record<number, string> = {
  0: "text-rose-400",
  1: "text-violet-400",
  2: "text-amber-400",
  3: "text-sky-400",
};
