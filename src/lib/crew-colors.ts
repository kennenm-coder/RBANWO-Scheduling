import { Crew, CrewType } from "./types";

/**
 * Per-type color palettes. A NEW resource is given the first color in its
 * type's palette that no sibling of that type already uses, so each resource
 * within a type reads as visually distinct. These are DEFAULTS written to
 * `crew.color` (shared by everyone); individual users can still override what
 * THEY see via preferences.color_overrides (see crewColorFor in preferences.ts).
 */
const TYPE_PALETTES: Record<string, string[]> = {
  measure_tech: ["#0d9488", "#0891b2", "#0ea5e9", "#2563eb", "#6366f1", "#14b8a6", "#06b6d4", "#3b82f6"],
  install_in_house: ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#be185d", "#0d9488", "#9333ea"],
  install_sub: ["#9333ea", "#c026d3", "#e11d48", "#f43f5e", "#a855f7", "#d946ef"],
  jip: ["#ca8a04", "#d97706", "#f59e0b", "#b45309", "#a16207"],
  svc: ["#e8710a", "#ea580c", "#f97316", "#c2410c", "#9a3412"],
  second: ["#16a34a", "#059669", "#65a30d", "#15803d", "#047857"],
  management: ["#7c3aed", "#6d28d9", "#5b21b6", "#8b5cf6", "#a855f7"],
  misc: ["#6b7280", "#4b5563", "#78716c", "#57534e", "#525252"],
};

const DEFAULT_PALETTE = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2"];

function hashPick(seed: string, palette: string[]): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/**
 * Pick a shared default color for a new resource that isn't already used by
 * other resources of the same type. Falls back to a deterministic hash pick if
 * every palette color is taken (so it's stable, not random).
 */
export function pickNewCrewColor(type: CrewType, existing: Crew[], seed = ""): string {
  const palette = TYPE_PALETTES[type] || DEFAULT_PALETTE;
  const used = new Set(
    existing
      .filter((c) => c.crew_type === type && c.color)
      .map((c) => c.color!.toLowerCase())
  );
  const free = palette.find((c) => !used.has(c.toLowerCase()));
  return free || hashPick(seed || String(existing.length), palette);
}
