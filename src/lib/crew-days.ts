/**
 * Which days of an appointment each crew actually works.
 *
 * A multi-day job is one appointment row with `duration_days`, and until now
 * every crew on it — lead and helpers alike — was booked for the whole span.
 * That is still the default: a helper with no day list works every day.
 *
 * A helper can now be marked *partial* and given the specific days it covers,
 * stored as 0-based positions within the span (day 1 = 0). Positions rather
 * than calendar dates so a helper's days follow the job when it is moved
 * instead of being stranded on dates the job no longer touches.
 *
 * The lead crew always works every day — it is the job's owner, and the DB
 * guard keys its uniqueness off `crew_id`.
 *
 * Both the client conflict check and the DB trigger reason in terms of
 * (crew, date) pairs built from here. They must agree; see
 * supabase/migrations/20261001_001_partial_helper_days.sql.
 */

import { addDays, format, parseISO } from "date-fns";
import { Appointment } from "./types";

/** Every date an appointment spans, YYYY-MM-DD, in order. */
export function getSpannedDates(startDate: string, durationDays: number): string[] {
  const dates: string[] = [];
  const start = parseISO(startDate);
  for (let d = 0; d < Math.max(1, durationDays); d++) {
    dates.push(format(addDays(start, d), "yyyy-MM-dd"));
  }
  return dates;
}

/**
 * Clean a day list for storage: unique, sorted, inside the span, and `null`
 * when it covers the whole span anyway (or is empty).
 *
 * Empty collapses to `null` — "assigned to no days" is never a state worth
 * persisting, and falling back to the whole span keeps a helper booked rather
 * than silently freeing them.
 */
export function normalizeDayOffsets(
  offsets: number[] | null | undefined,
  durationDays: number
): number[] | null {
  if (!offsets) return null;
  const span = Math.max(1, durationDays);
  const clean = Array.from(
    new Set(offsets.filter((n) => Number.isInteger(n) && n >= 0 && n < span))
  ).sort((a, b) => a - b);
  if (clean.length === 0 || clean.length === span) return null;
  return clean;
}

/** The raw day list stored for a helper slot, or `null` for the whole span. */
export function helperDayOffsets(
  appointment: Pick<
    Appointment,
    "secondary_crew_id" | "tertiary_crew_id" | "secondary_day_offsets" | "tertiary_day_offsets"
  >,
  crewId: string
): number[] | null {
  if (crewId && appointment.secondary_crew_id === crewId) {
    return appointment.secondary_day_offsets ?? null;
  }
  if (crewId && appointment.tertiary_crew_id === crewId) {
    return appointment.tertiary_day_offsets ?? null;
  }
  return null;
}

/** Is this crew on the appointment at all (any day)? */
export function appointmentHasCrew(
  appointment: Pick<Appointment, "crew_id" | "secondary_crew_id" | "tertiary_crew_id">,
  crewId: string
): boolean {
  if (!crewId) return false;
  return (
    appointment.crew_id === crewId ||
    appointment.secondary_crew_id === crewId ||
    appointment.tertiary_crew_id === crewId
  );
}

/** The day positions a crew works. `null` means every day of the span. */
export function crewDayOffsets(
  appointment: Pick<
    Appointment,
    | "crew_id"
    | "secondary_crew_id"
    | "tertiary_crew_id"
    | "secondary_day_offsets"
    | "tertiary_day_offsets"
    | "duration_days"
  >,
  crewId: string
): number[] | null {
  // The lead is on every day, whatever a stale helper list might say.
  if (appointment.crew_id === crewId) return null;
  return normalizeDayOffsets(
    helperDayOffsets(appointment, crewId),
    appointment.duration_days
  );
}

/** The dates a crew works on this appointment. Empty when it isn't on the job. */
export function crewDatesForAppointment(
  appointment: Appointment,
  crewId: string
): string[] {
  if (!appointment.scheduled_date || !appointmentHasCrew(appointment, crewId)) return [];
  const dates = getSpannedDates(appointment.scheduled_date, appointment.duration_days);
  const offsets = crewDayOffsets(appointment, crewId);
  if (!offsets) return dates;
  return offsets.map((i) => dates[i]).filter(Boolean);
}

/** Does this crew work this appointment on this date? */
export function crewWorksDate(
  appointment: Appointment,
  crewId: string,
  dateStr: string
): boolean {
  return crewDatesForAppointment(appointment, crewId).includes(dateStr);
}

/** Every (crew → dates it occupies) pair on an appointment. */
export function appointmentCrewDates(appointment: Appointment): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!appointment.scheduled_date) return out;
  for (const crewId of [
    appointment.crew_id,
    appointment.secondary_crew_id,
    appointment.tertiary_crew_id,
  ]) {
    if (!crewId || out.has(crewId)) continue;
    out.set(crewId, new Set(crewDatesForAppointment(appointment, crewId)));
  }
  return out;
}

/**
 * The `extraCrewDays` map the conflict checker wants: helper crew id → its day
 * list (null = the whole span). If one crew somehow fills both helper slots the
 * two lists are unioned, so neither booking is lost.
 */
export function extraCrewDaysOf(
  appointment: Pick<
    Appointment,
    "secondary_crew_id" | "tertiary_crew_id" | "secondary_day_offsets" | "tertiary_day_offsets"
  >
): Record<string, number[] | null> {
  const out: Record<string, number[] | null> = {};
  const add = (id: string | null, offsets: number[] | null | undefined) => {
    if (!id) return;
    if (!(id in out)) {
      out[id] = offsets ?? null;
      return;
    }
    const prev = out[id];
    // One side covering the whole span swallows the other.
    out[id] = prev === null || !offsets ? null : Array.from(new Set([...prev, ...offsets])).sort((a, b) => a - b);
  };
  add(appointment.secondary_crew_id, appointment.secondary_day_offsets);
  add(appointment.tertiary_crew_id, appointment.tertiary_day_offsets);
  return out;
}

/** Day positions a helper covers, as human day numbers ("Day 1 and 3"). */
export function describeHelperDays(
  offsets: number[] | null | undefined,
  durationDays: number
): string | null {
  const clean = normalizeDayOffsets(offsets, durationDays);
  if (!clean) return null;
  const nums = clean.map((i) => i + 1);
  if (nums.length === 1) return `Day ${nums[0]}`;
  return `Days ${nums.slice(0, -1).join(", ")} & ${nums[nums.length - 1]}`;
}
