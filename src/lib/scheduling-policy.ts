/**
 * Scheduling Policy — single source of truth for how each appointment type
 * is scheduled.
 *
 * Every view (Day, Week, Block) and the ScheduleModal consult this module
 * instead of hardcoding scheduling mode decisions independently.
 */

import { AppointmentType, TimeBlock } from "./types";
import { MEASURE_TIME_BLOCKS, timeBlockStartEnd } from "./calendar-utils";

// ── Scheduling modes ──

export type SchedulingMode = "fixed_block" | "timed" | "full_day";

const TYPE_MODE: Record<AppointmentType, SchedulingMode> = {
  tech_measure: "fixed_block",
  install: "full_day",
  service: "timed",
  jip: "timed",
  lswp: "full_day",
  hoa: "timed",
  paint_stain: "timed",
};

/** Get the scheduling mode for an appointment type. */
export function getSchedulingMode(type: AppointmentType): SchedulingMode {
  return TYPE_MODE[type] ?? "timed";
}

/** Whether this type uses fixed time blocks (measures). */
export function isFixedBlock(type: AppointmentType): boolean {
  return getSchedulingMode(type) === "fixed_block";
}

/** Whether this type allows flexible start/end times. */
export function isTimed(type: AppointmentType): boolean {
  return getSchedulingMode(type) === "timed";
}

/** Whether this type defaults to full-day / multi-day scheduling. */
export function isFullDay(type: AppointmentType): boolean {
  return getSchedulingMode(type) === "full_day";
}

// ── Default time derivation ──

/** Department default workday start. */
const DEPT_START: Record<SchedulingMode, string> = {
  fixed_block: "09:00",
  timed: "08:00",
  full_day: "08:00",
};

const DEPT_END: Record<SchedulingMode, string> = {
  fixed_block: "18:00",
  timed: "17:00",
  full_day: "16:00",
};

/** Get default start/end time for an appointment type. */
export function getDefaultTimes(type: AppointmentType): { start: string; end: string } {
  const mode = getSchedulingMode(type);
  return { start: DEPT_START[mode], end: DEPT_END[mode] };
}

/**
 * Get the valid time blocks for a type (only meaningful for fixed_block mode).
 * Returns null for timed/full_day types.
 */
export function getValidBlocks(type: AppointmentType): TimeBlock[] | null {
  if (getSchedulingMode(type) === "fixed_block") {
    return [...MEASURE_TIME_BLOCKS];
  }
  return null;
}

/**
 * Resolve start/end times for a scheduling target.
 *
 * - fixed_block: derives from the time block
 * - timed: uses provided start/end or defaults
 * - full_day: uses workday start/end
 */
export function resolveScheduleTimes(
  type: AppointmentType,
  opts: {
    timeBlock?: TimeBlock | null;
    startTime?: string | null;
    endTime?: string | null;
  }
): { start: string; end: string; timeBlock: TimeBlock | null } {
  const mode = getSchedulingMode(type);

  if (mode === "fixed_block" && opts.timeBlock && opts.timeBlock !== "full_day") {
    const { start, end } = timeBlockStartEnd(opts.timeBlock);
    return { start, end, timeBlock: opts.timeBlock };
  }

  if (mode === "full_day") {
    const defaults = getDefaultTimes(type);
    return {
      start: opts.startTime || defaults.start,
      end: opts.endTime || defaults.end,
      timeBlock: "full_day",
    };
  }

  // timed mode
  const defaults = getDefaultTimes(type);
  return {
    start: opts.startTime || defaults.start,
    end: opts.endTime || defaults.end,
    timeBlock: opts.timeBlock || null,
  };
}

/**
 * Calculate the default start time after the last appointment on a crew/day.
 * Used by Block View when dropping without a specific time.
 */
export function getNextAvailableStart(
  existingEndTimes: string[],
  type: AppointmentType
): string {
  if (existingEndTimes.length === 0) {
    return getDefaultTimes(type).start;
  }
  // Sort descending and take the latest
  const sorted = [...existingEndTimes].sort().reverse();
  return sorted[0];
}

/**
 * Snap a time to the nearest 30-minute increment.
 * E.g., 10:17 → 10:00, 10:23 → 10:30
 */
export function snapTo30Min(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || "0", 10);
  const snappedM = Math.round(m / 30) * 30;
  const finalH = snappedM === 60 ? h + 1 : h;
  const finalM = snappedM === 60 ? 0 : snappedM;
  return `${String(finalH).padStart(2, "0")}:${String(finalM).padStart(2, "0")}`;
}

/**
 * Compute the end time by adding a duration (in minutes) to a start time.
 */
export function addMinutesToTime(time: string, minutes: number): string {
  const [hStr, mStr] = time.split(":");
  const totalMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr || "0", 10) + minutes;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(Math.min(h, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Calculate duration in minutes between two HH:MM times.
 */
export function timeDurationMinutes(start: string, end: string): number {
  const [sH, sM] = start.split(":").map(Number);
  const [eH, eM] = end.split(":").map(Number);
  return (eH * 60 + eM) - (sH * 60 + sM);
}
