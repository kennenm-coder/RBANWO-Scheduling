/**
 * App-side scheduling validation — detects conflicts BEFORE hitting the DB.
 *
 * The DB has a partial unique index `idx_no_double_book(crew_id, scheduled_date, time_block)`
 * but it can't catch:
 *   - Multi-day overlaps (3-day install blocks the crew for days 2 and 3 too)
 *   - Multi-block overlaps (appointment spanning 10-12 → 12-2 also blocks the 12-2 slot)
 *   - Full-day vs block conflicts (full_day should block every measure block and vice versa)
 *
 * This module runs client-side before any create/update so the scheduler gets
 * an immediate, friendly error instead of a cryptic Postgres 23505.
 */

import { Appointment, TimeBlock } from "./types";
import { getSpannedBlocks, timeBlockStartEnd } from "./calendar-utils";
import { addDays, format, parseISO } from "date-fns";

export interface SchedulingConflict {
  /** The existing appointment that conflicts */
  conflictingAppointmentId: string;
  /** Human-readable customer name for the error message */
  customerName: string;
  /** What kind of conflict */
  reason: "same_block" | "multi_day_overlap" | "multi_block_overlap" | "full_day_conflict" | "time_overlap";
  /** The date where the conflict occurs */
  conflictDate: string;
  /** The overlapping time block (the existing job's block, or "full_day", when no block is involved) */
  conflictBlock: TimeBlock;
  /** The existing job's timed window, when it has one (HH:MM). */
  conflictWindow?: { start: string; end: string };
}

/** Extra facts about the NEW booking that a block alone can't express. */
export interface ConflictCheckOptions {
  /** Timed window (HH:MM) — decides overlap when either side has no block. */
  startTime?: string | null;
  endTime?: string | null;
  /** Explicit all-day flag (an install with the box on). */
  isFullDay?: boolean | null;
  /** Helper crews of the new booking — each must be free as well. */
  extraCrewIds?: (string | null | undefined)[];
}

/**
 * Get all dates an appointment spans, given its start date and duration.
 */
function getSpannedDates(startDate: string, durationDays: number): string[] {
  const dates: string[] = [];
  const start = parseISO(startDate);
  for (let d = 0; d < Math.max(1, durationDays); d++) {
    dates.push(format(addDays(start, d), "yyyy-MM-dd"));
  }
  return dates;
}

/**
 * How a booking occupies a crew's day — the same three shapes the DB trigger
 * reasons about: whole day, measure blocks, or a timed window.
 */
interface Footprint {
  /** Whole day blocked — conflicts with anything on that day. */
  fullDay: boolean;
  /** Measure blocks occupied (empty for full-day and timed work). */
  blocks: TimeBlock[];
  /** Minutes from midnight. Block-based work derives it from its blocks. */
  window: { start: number; end: number } | null;
}

function toMinutes(time: string): number {
  const [h, m] = time.slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
}

function buildFootprint(
  timeBlock: TimeBlock | null | undefined,
  timeBlockEnd: TimeBlock | null | undefined,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  isFullDay: boolean | null | undefined
): Footprint {
  if (isFullDay || timeBlock === "full_day") return { fullDay: true, blocks: [], window: null };

  const blocks = timeBlock
    ? getSpannedBlocks({ time_block: timeBlock, time_block_end: timeBlockEnd ?? null } as Appointment)
    : [];

  let window: Footprint["window"] = null;
  if (blocks.length > 0) {
    window = {
      start: toMinutes(timeBlockStartEnd(blocks[0]).start),
      end: toMinutes(timeBlockStartEnd(blocks[blocks.length - 1]).end),
    };
  } else if (startTime && endTime) {
    window = { start: toMinutes(startTime), end: toMinutes(endTime) };
  }
  return { fullDay: false, blocks, window };
}

/**
 * Do two footprints collide on the same day? Mirrors the DB trigger: a full day
 * collides with everything; otherwise the timed windows must overlap (block
 * windows come from their blocks, so a measure vs a service is judged the same
 * way the trigger judges it). Timed work used to be invisible here — two
 * overlapping services on one crew never produced a client-side conflict.
 */
function footprintsOverlap(
  a: Footprint,
  b: Footprint
): { block: TimeBlock | null; timed: boolean } | null {
  if (a.fullDay || b.fullDay) return { block: a.blocks[0] ?? b.blocks[0] ?? null, timed: false };
  if (a.blocks.length > 0 && b.blocks.length > 0) {
    const hit = a.blocks.find((x) => b.blocks.includes(x));
    return hit ? { block: hit, timed: false } : null;
  }
  if (a.window && b.window && a.window.start < b.window.end && a.window.end > b.window.start) {
    return { block: a.blocks[0] ?? b.blocks[0] ?? null, timed: true };
  }
  return null;
}

/**
 * Validate that scheduling an appointment won't double-book a crew.
 *
 * Returns an array of conflicts (empty = no conflicts = safe to schedule).
 *
 * @param crewId - The crew being assigned
 * @param startDate - The start date (YYYY-MM-DD)
 * @param durationDays - Number of days the appointment spans (usually 1)
 * @param timeBlock - The time block being requested (null for timed work)
 * @param timeBlockEnd - End of multi-block span (null for single block)
 * @param allAppointments - All appointments to check against
 * @param excludeId - Appointment ID to exclude (for updates/rescheduling)
 * @param opts - Timed window / all-day flag / helper crews of the new booking
 */
export function checkSchedulingConflicts(
  crewId: string,
  startDate: string,
  durationDays: number,
  timeBlock: TimeBlock | null,
  timeBlockEnd: TimeBlock | null | undefined,
  allAppointments: Appointment[],
  excludeId?: string,
  opts: ConflictCheckOptions = {}
): SchedulingConflict[] {
  const conflicts: SchedulingConflict[] = [];

  // The dates and the shape this new appointment would occupy
  const newDates = getSpannedDates(startDate, durationDays);
  const newFoot = buildFootprint(timeBlock, timeBlockEnd, opts.startTime, opts.endTime, opts.isFullDay);
  // Every crew on the new booking must be free — helpers included.
  const newCrews = new Set(
    [crewId, ...(opts.extraCrewIds ?? [])].filter((c): c is string => !!c)
  );

  // Only check active appointments that share a crew with the new booking
  const relevantAppointments = allAppointments.filter(
    (a) =>
      a.status !== "cancelled" &&
      a.status !== "unscheduled" &&
      a.id !== excludeId &&
      [a.crew_id, a.secondary_crew_id, a.tertiary_crew_id].some((c) => !!c && newCrews.has(c))
  );

  for (const existing of relevantAppointments) {
    if (!existing.scheduled_date) continue;

    const existingDates = getSpannedDates(existing.scheduled_date, existing.duration_days);
    const existingFoot = buildFootprint(
      existing.time_block,
      existing.time_block_end,
      existing.start_time,
      existing.end_time,
      existing.is_full_day
    );

    // Find overlapping dates
    for (const date of newDates) {
      if (!existingDates.includes(date)) continue;

      // Found a date overlap — check whether the two footprints collide
      const hit = footprintsOverlap(newFoot, existingFoot);
      if (!hit) continue;

      // Determine the conflict type
      let reason: SchedulingConflict["reason"] = "same_block";
      if (existing.duration_days > 1 || durationDays > 1) {
        // Either the existing or new appointment spans multiple days
        reason = "multi_day_overlap";
      } else if (hit.timed) {
        reason = "time_overlap";
      } else if (existing.time_block_end || timeBlockEnd) {
        reason = "multi_block_overlap";
      } else if (newFoot.fullDay || existingFoot.fullDay) {
        reason = "full_day_conflict";
      }

      conflicts.push({
        conflictingAppointmentId: existing.id,
        customerName: existing.customer_name,
        reason,
        conflictDate: date,
        conflictBlock: hit.block ?? existing.time_block ?? "full_day",
        conflictWindow:
          existing.start_time && existing.end_time
            ? { start: existing.start_time.slice(0, 5), end: existing.end_time.slice(0, 5) }
            : undefined,
      });
      break; // One conflict per existing appointment is enough
    }
  }

  return conflicts;
}

/**
 * Human-readable conflict message for UI display.
 */
export function formatConflictMessage(conflict: SchedulingConflict): string {
  switch (conflict.reason) {
    case "same_block":
      return `${conflict.customerName} is already scheduled in the ${conflict.conflictBlock} block on ${conflict.conflictDate}`;
    case "multi_day_overlap":
      return `${conflict.customerName} has a multi-day job that spans ${conflict.conflictDate}`;
    case "multi_block_overlap":
      return `${conflict.customerName} has an appointment spanning the ${conflict.conflictBlock} block on ${conflict.conflictDate}`;
    case "full_day_conflict":
      return `${conflict.customerName} has a full-day appointment on ${conflict.conflictDate}`;
    case "time_overlap":
      return conflict.conflictWindow
        ? `${conflict.customerName} is already booked ${conflict.conflictWindow.start}–${conflict.conflictWindow.end} on ${conflict.conflictDate}`
        : `${conflict.customerName} is already booked at that time on ${conflict.conflictDate}`;
  }
}
