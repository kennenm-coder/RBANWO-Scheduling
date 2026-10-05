import type { CSSProperties } from "react";
import { AvailabilityKind } from "./types";

/**
 * How a day that can't be booked is drawn.
 *
 * Every reason a resource is unbookable — PTO, an Unavailable rule, an Office
 * or Late day, a company holiday or all-office meeting — gets one accent color
 * and one treatment: a full-strength tint mixed against the theme background,
 * a solid accent bar down the left edge, and a label in the accent rather than
 * in muted grey.
 *
 * Previously each view improvised its own: the block grid drew grey text at 60%
 * opacity with no tint at all, the week grid used a 40% wash of a token that in
 * the cream theme was within a shade of --surface, and the day view hardcoded
 * Tailwind amber so cream never got its own color. A blocked day could be
 * invisible depending on which view and which theme you were in.
 *
 * Accents are CSS variables, so each theme supplies its own values (see
 * globals.css). The tint is derived with color-mix against --background, which
 * is what keeps one definition legible on white, near-black and ivory alike.
 */
export interface BlockedVisual {
  /** CSS color for the bar, icon and label. */
  accent: string;
  /** Short text for the cell, e.g. "PTO". */
  label: string;
  /** Which icon the views should draw. */
  icon: "palm" | "ban" | "sunset" | "building";
}

const VISUALS: Record<string, BlockedVisual> = {
  pto: { accent: "var(--blk-pto)", label: "PTO", icon: "palm" },
  unavailable: { accent: "var(--blk-unavailable)", label: "Unavailable", icon: "ban" },
  office_day: { accent: "var(--blk-office)", label: "Office", icon: "building" },
  late_day: { accent: "var(--blk-late)", label: "Late Day", icon: "sunset" },
  holiday: { accent: "var(--blk-holiday)", label: "Holiday", icon: "palm" },
  company_meeting: { accent: "var(--blk-meeting)", label: "Office Meeting", icon: "building" },
};

/** External time off (an rForce request), which has no AvailabilityKind. */
export const TIME_OFF_VISUAL: BlockedVisual = VISUALS.pto;

/**
 * The treatment for a blocking kind.
 *
 * `timeOffColor` is the viewer's own time-off color from preferences; when set
 * it replaces the PTO accent only, leaving the other reasons on their theme
 * colors so they stay distinguishable.
 */
export function blockedVisualFor(
  kind: AvailabilityKind | undefined,
  opts?: { timeOffColor?: string }
): BlockedVisual {
  const base = (kind && VISUALS[kind]) || VISUALS.unavailable;
  if (opts?.timeOffColor && (kind === "pto" || kind === undefined)) {
    return { ...base, accent: opts.timeOffColor };
  }
  return base;
}

/** The same, for external time off, honouring the viewer's chosen color. */
export function timeOffVisual(timeOffColor?: string): BlockedVisual {
  return timeOffColor ? { ...TIME_OFF_VISUAL, accent: timeOffColor } : TIME_OFF_VISUAL;
}

/**
 * Cell styling for a blocked day: the tint plus the left accent bar.
 *
 * `edge` is off for a cell that sits mid-row, where a bar on every cell would
 * read as a grid line rather than a marker.
 */
export function blockedCellStyle(
  visual: BlockedVisual,
  opts?: { edge?: boolean }
): CSSProperties {
  const style: CSSProperties = {
    backgroundColor: `color-mix(in srgb, ${visual.accent} var(--blk-tint), var(--background))`,
  };
  if (opts?.edge !== false) {
    style.borderLeft = `3px solid ${visual.accent}`;
  }
  return style;
}

/**
 * A lighter wash for a single blocked time block inside an otherwise workable
 * day — a 10-11 office meeting greys one row, not the whole column.
 */
export function blockedSlotStyle(visual: BlockedVisual): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${visual.accent} calc(var(--blk-tint) / 2), var(--background))`,
  };
}
