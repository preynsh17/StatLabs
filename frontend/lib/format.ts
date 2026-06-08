const LOWERCASE_PARTICLES = new Set(["de", "da", "van", "von", "del", "der", "di", "le", "la", "los", "las", "bin", "binte"]);

export function formatName(raw: string): string {
  return raw
    .split(" ")
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && LOWERCASE_PARTICLES.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
