/**
 * Guardrails against nonsensical calendar dates.
 *
 * A native `<input type="date">` will happily accept a 2-digit year typed into
 * the year segment — "26" becomes the year 0026 — and nothing downstream
 * questioned it, so an appointment could save ~2000 years in the past. It then
 * vanished from every calendar view (wrong year) while still holding its work
 * order, silently blocking that job from being rescheduled.
 *
 * These bounds are deliberately wide: they only reject dates that cannot
 * possibly be a real scheduling entry, never a plausible one.
 */

/** Earliest / latest year a scheduling date may carry. */
export const MIN_SCHEDULE_YEAR = 2000;
export const MAX_SCHEDULE_YEAR = 2100;

/** `min`/`max` bounds for a scheduling `<input type="date">`. */
export const DATE_INPUT_MIN = `${MIN_SCHEDULE_YEAR}-01-01`;
export const DATE_INPUT_MAX = `${MAX_SCHEDULE_YEAR}-12-31`;

/**
 * Is `value` a well-formed `YYYY-MM-DD` date with a plausible year?
 * Rejects blanks, malformed strings, and absurd years (e.g. 0026 from a
 * mistyped 2-digit year). Does not otherwise judge how far out the date is.
 */
export function isPlausibleScheduleDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_SCHEDULE_YEAR || year > MAX_SCHEDULE_YEAR) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  return true;
}
