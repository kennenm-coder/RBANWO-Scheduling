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
import { MEASURE_TIME_BLOCKS, getSpannedBlocks } from "./calendar-utils";
import { addDays, format, parseISO } from "date-fns";

export interface SchedulingConflict {
  /** The existing appointment that conflicts */
  conflictingAppointmentId: string;
  /** Human-readable customer name for the error message */
  customerName: string;
  /** What kind of conflict */
  reason: "same_block" | "multi_day_overlap" | "multi_block_overlap" | "full_day_conflict";
  /** The date where the conflict occurs */
  conflictDate: string;
  /** The overlapping time block */
  conflictBlock: TimeBlock;
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
 * Get all time blocks an appointment occupies (accounting for multi-block spans and full_day).
 */
function getOccupiedBlocks(timeBlock: TimeBlock | null, timeBlockEnd?: TimeBlock | null): TimeBlock[] {
  if (!timeBlock) return [];
  if (timeBlock === "full_day") return ["full_day", ...MEASURE_TIME_BLOCKS];
  const spanned = getSpannedBlocks({
    time_block: timeBlock,
    time_block_end: timeBlockEnd ?? null,
  } as Appointment);
  return spanned;
}

/**
 * Check if two sets of time blocks overlap.
 * Full-day conflicts with everything.
 */
function blocksOverlap(blocksA: TimeBlock[], blocksB: TimeBlock[]): TimeBlock | null {
  // Full-day in either set conflicts with any block in the other
  if (blocksA.includes("full_day") && blocksB.length > 0) return blocksB[0];
  if (blocksB.includes("full_day") && blocksA.length > 0) return blocksA[0];

  for (const b of blocksA) {
    if (blocksB.includes(b)) return b;
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
 * @param timeBlock - The time block being requested
 * @param timeBlockEnd - End of multi-block span (null for single block)
 * @param allAppointments - All appointments to check against
 * @param excludeId - Appointment ID to exclude (for updates/rescheduling)
 */
export function checkSchedulingConflicts(
  crewId: string,
  startDate: string,
  durationDays: number,
  timeBlock: TimeBlock,
  timeBlockEnd: TimeBlock | null | undefined,
  allAppointments: Appointment[],
  excludeId?: string
): SchedulingConflict[] {
  const conflicts: SchedulingConflict[] = [];

  // The dates this new appointment would occupy
  const newDates = getSpannedDates(startDate, durationDays);
  // The blocks this new appointment would occupy
  const newBlocks = getOccupiedBlocks(timeBlock, timeBlockEnd);

  // Only check active appointments for the same crew
  const relevantAppointments = allAppointments.filter(
    (a) =>
      a.status !== "cancelled" &&
      a.status !== "unscheduled" &&
      a.id !== excludeId &&
      (a.crew_id === crewId || a.secondary_crew_id === crewId || a.tertiary_crew_id === crewId)
  );

  for (const existing of relevantAppointments) {
    if (!existing.scheduled_date) continue;

    const existingDates = getSpannedDates(existing.scheduled_date, existing.duration_days);
    const existingBlocks = getOccupiedBlocks(existing.time_block, existing.time_block_end);

    // Find overlapping dates
    for (const date of newDates) {
      if (!existingDates.includes(date)) continue;

      // Found a date overlap — check block overlap
      const overlapBlock = blocksOverlap(newBlocks, existingBlocks);
      if (overlapBlock) {
        // Determine the conflict type
        let reason: SchedulingConflict["reason"] = "same_block";
        if (existing.scheduled_date !== startDate && existing.duration_days > 1) {
          reason = "multi_day_overlap";
        } else if (existing.time_block_end || timeBlockEnd) {
          reason = "multi_block_overlap";
        } else if (
          timeBlock === "full_day" ||
          existing.time_block === "full_day"
        ) {
          reason = "full_day_conflict";
        }

        conflicts.push({
          conflictingAppointmentId: existing.id,
          customerName: existing.customer_name,
          reason,
          conflictDate: date,
          conflictBlock: overlapBlock,
        });
        break; // One conflict per existing appointment is enough
      }
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
  }
}
