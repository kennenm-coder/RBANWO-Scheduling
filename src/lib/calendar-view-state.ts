import { format, parseISO, isValid } from "date-fns";
import { isPlausibleScheduleDate } from "./date-guard";
import type { ViewMode } from "./types";

/**
 * Where the calendar was left: which view, and which day/week was on screen.
 *
 * Deliberately localStorage and not `sched_user_preferences`: "the day I was
 * looking at" belongs to *this* browser. Syncing it would yank the phone to
 * whatever day the desktop last opened. The key is namespaced by user id so
 * two accounts sharing a machine don't inherit each other's position.
 */
export interface CalendarViewState {
  view: ViewMode;
  /** yyyy-MM-dd — stored date-only so a restore never shifts by timezone. */
  date: string;
}

const KEY_PREFIX = "rbanwo-sched-calendar-state";
/** Pre-namespacing key that held the view alone. Read once, then migrated. */
const LEGACY_VIEW_KEY = "rbanwo-sched-view";

export const DEFAULT_VIEW: ViewMode = "week";

function isViewMode(v: unknown): v is ViewMode {
  return v === "day" || v === "week" || v === "block";
}

/** Storage key for a user. Signed-out/dev sessions share the `local` slot. */
export function calendarStateKey(userId: string | null | undefined): string {
  return `${KEY_PREFIX}:${userId || "local"}`;
}

/**
 * Restore the saved position, or null when there isn't a usable one.
 * A corrupt/legacy/implausible entry degrades to "no saved position" rather
 * than throwing — the caller then falls back to today.
 */
export function readCalendarViewState(key: string): CalendarViewState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_VIEW_KEY);
      return isViewMode(legacy) ? { view: legacy, date: format(new Date(), "yyyy-MM-dd") } : null;
    }
    const parsed = JSON.parse(raw) as Partial<CalendarViewState>;
    const view = isViewMode(parsed.view) ? parsed.view : DEFAULT_VIEW;
    const date =
      typeof parsed.date === "string" && isPlausibleScheduleDate(parsed.date)
        ? parsed.date
        : null;
    if (!date) return null;
    return { view, date };
  } catch {
    return null;
  }
}

export function writeCalendarViewState(key: string, state: CalendarViewState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Private mode / quota — losing the position is not worth breaking a render.
  }
}

/** Saved view, or the default when nothing usable is stored. */
export function restoredView(state: CalendarViewState | null): ViewMode {
  return state?.view ?? DEFAULT_VIEW;
}

/** Saved day as a Date, or today when nothing usable is stored. */
export function restoredDate(state: CalendarViewState | null): Date {
  if (!state) return new Date();
  const parsed = parseISO(state.date);
  return isValid(parsed) ? parsed : new Date();
}
