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
import { getSpannedBlocks, timeBlockStartEnd, REMOTE_BLOCK } from "./calendar-utils";
import {
  appointmentCrewDates,
  getSpannedDates,
  normalizeDayOffsets,
} from "./crew-days";

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
  /**
   * Days a partial helper covers, keyed by crew id, as 0-based positions in the
   * span. A helper absent from here (or mapped to null) works the whole span —
   * the default. See crew-days.ts.
   */
  extraCrewDays?: Record<string, number[] | null | undefined>;
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
  /**
   * A remote measure — it occupies none of the tech's day, so it collides with
   * nothing (not even a full-day job) and nothing collides with it. Mirrors the
   * DB guard, which returns early for remote rows on either side.
   */
  remote: boolean;
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
  if (timeBlock === REMOTE_BLOCK) {
    return { fullDay: false, blocks: [], window: null, remote: true };
  }
  if (isFullDay || timeBlock === "full_day") {
    return { fullDay: true, blocks: [], window: null, remote: false };
  }

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
  return { fullDay: false, blocks, window, remote: false };
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
  // A remote measure takes no time from the tech's day — it stacks freely on
  // the remote row and never blocks (or is blocked by) on-site work.
  if (a.remote || b.remote) return null;
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

  // The shape this new appointment would occupy
  const newFoot = buildFootprint(timeBlock, timeBlockEnd, opts.startTime, opts.endTime, opts.isFullDay);

  // Every crew on the new booking must be free — helpers included — but each on
  // its OWN days. The lead works the whole span; a partial helper only the days
  // it was given, so it cannot collide on a day it isn't there.
  const spanDates = getSpannedDates(startDate, durationDays);
  const newCrewDates = new Map<string, Set<string>>();
  const claimDays = (id: string | null | undefined, offsets: number[] | null | undefined) => {
    if (!id || newCrewDates.has(id)) return;
    const days = normalizeDayOffsets(offsets, durationDays);
    newCrewDates.set(
      id,
      new Set(days ? days.map((i) => spanDates[i]).filter(Boolean) : spanDates)
    );
  };
  claimDays(crewId, null);
  for (const id of opts.extraCrewIds ?? []) {
    claimDays(id, id ? opts.extraCrewDays?.[id] : null);
  }

  // Only check active appointments that share a crew with the new booking
  const relevantAppointments = allAppointments.filter(
    (a) =>
      a.status !== "cancelled" &&
      a.status !== "unscheduled" &&
      a.id !== excludeId &&
      [a.crew_id, a.secondary_crew_id, a.tertiary_crew_id].some((c) => !!c && newCrewDates.has(c))
  );

  for (const existing of relevantAppointments) {
    if (!existing.scheduled_date) continue;

    const existingFoot = buildFootprint(
      existing.time_block,
      existing.time_block_end,
      existing.start_time,
      existing.end_time,
      existing.is_full_day
    );

    // A real clash needs the SAME crew standing on the SAME date on both sides.
    // Comparing spans alone would flag a helper on a day it doesn't work.
    const existingCrewDates = appointmentCrewDates(existing);
    const shared: string[] = [];
    for (const [id, dates] of newCrewDates) {
      const theirs = existingCrewDates.get(id);
      if (!theirs) continue;
      for (const date of dates) {
        if (theirs.has(date)) shared.push(date);
      }
    }
    if (shared.length === 0) continue;

    // Found a date overlap — check whether the two footprints collide
    const hit = footprintsOverlap(newFoot, existingFoot);
    if (!hit) continue;

    // Report the earliest clashing day, whichever crew it came from
    const date = shared.sort()[0];

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

    // One conflict per existing appointment is enough
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
