import { addDays, subDays, format, parseISO } from "date-fns";

/**
 * The span of `scheduled_date` the app currently holds appointments for.
 * Both ends inclusive, `yyyy-MM-dd` so comparisons are plain string compares
 * and never shift by timezone.
 */
export interface DateWindow {
  start: string;
  end: string;
}

/** Re-fetch once the viewed date comes within this many days of either edge. */
export const WINDOW_MARGIN_DAYS = 14;
/** How far either side of a newly opened date the window should reach. */
export const WINDOW_BACK_DAYS = 60;
export const WINDOW_FORWARD_DAYS = 180;

export interface WindowExtension {
  /** The window after growing. Never narrower than the one passed in. */
  window: DateWindow;
  /** Inclusive `[start, end]` spans not already covered, so a caller fetches
   *  only what it is missing. Disjoint from the old window and from each other. */
  gaps: Array<[string, string]>;
}

/**
 * Work out how to cover `date` without losing anything already loaded.
 *
 * The window GROWS; it never slides onto the new date. Re-centring was a real
 * defect: appointments outside the new span were dropped from memory, and
 * because rForce pairing is derived by looking appointments up in that list, a
 * dropped tile reads as "not on calendar". rForce orders carry no upper date
 * bound while appointments do, so opening an issue tile a few weeks back could
 * unpair the whole board until the page was reloaded.
 *
 * Returns null when `date` is already comfortably inside the window.
 */
export function planWindowExtension(
  current: DateWindow,
  date: Date
): WindowExtension | null {
  const margin = format(addDays(date, WINDOW_MARGIN_DAYS), "yyyy-MM-dd");
  const marginBefore = format(subDays(date, WINDOW_MARGIN_DAYS), "yyyy-MM-dd");
  if (margin <= current.end && marginBefore >= current.start) return null;

  const wantStart = format(subDays(date, WINDOW_BACK_DAYS), "yyyy-MM-dd");
  const wantEnd = format(addDays(date, WINDOW_FORWARD_DAYS), "yyyy-MM-dd");
  // min/max, not replace — this is the whole point.
  const start = wantStart < current.start ? wantStart : current.start;
  const end = wantEnd > current.end ? wantEnd : current.end;

  const gaps: Array<[string, string]> = [];
  if (start < current.start) {
    gaps.push([start, format(subDays(parseISO(current.start), 1), "yyyy-MM-dd")]);
  }
  if (end > current.end) {
    gaps.push([format(addDays(parseISO(current.end), 1), "yyyy-MM-dd"), end]);
  }
  if (gaps.length === 0) return null;

  return { window: { start, end }, gaps };
}
