/**
 * Hard limits the scheduler applies to a booking's shape. Kept in a leaf
 * module (no imports) so the store, the rForce status derivation and the
 * Issues page can all share ONE number without pulling in each other.
 */

/** Longest multi-day job the calendar will book as a single tile. */
export const MAX_MULTI_DAY_SPAN = 14;

/**
 * Clamp a day count into [1, MAX_MULTI_DAY_SPAN]. Approval used to drop a
 * 15+-day rForce range to a single day, which the Issues page then reported as
 * "under-scheduled" and its fixer extended to the full, uncapped span — the
 * two sides disagreed on what the cap even was.
 */
export function clampMultiDaySpan(days: number): number {
  if (!Number.isFinite(days) || days < 1) return 1;
  return Math.min(Math.round(days), MAX_MULTI_DAY_SPAN);
}
