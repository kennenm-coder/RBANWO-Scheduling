/**
 * rForce time derivation — single source of truth for turning an rForce order's
 * scheduled window into an appointment's start_time / end_time / time_block.
 *
 * Historically the approve/schedule flows derived times from the chosen time
 * BLOCK (e.g. full_day → 08:00–16:00) and never looked at the order's real
 * scheduled_start / scheduled_end. That stamped every full-day-defaulted job
 * (services, JIPs, partial installs, queue-dropped measures) with a bogus
 * 08:00–16:00 window, so the timeline views drew an all-day bar. This module
 * carries the real rForce time instead. It is used by BOTH the live write paths
 * and the one-time data backfill so the two can never diverge.
 */
import { AppointmentType, TimeBlock } from "./types";
import { getSchedulingMode } from "./scheduling-policy";
import { timeToBlock } from "./crew-match";

export interface DerivedTimes {
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
  time_block: TimeBlock | null;
}

/**
 * Wall-clock "HH:MM" from a stored rForce timestamp.
 *
 * rForce timestamps are imported as naive local wall-clock strings into a
 * timestamptz column (they come back with a +00 offset), so a raw slice of the
 * time portion yields the intended local time. This matches how the rest of the
 * app already reads rForce times (e.g. CrewLaneDayView's `.slice(11, 16)`), and
 * the live DB confirms it (measures read back as 10:00–11:00, not shifted).
 */
export function rforceWallClock(iso: string | null | undefined): string | null {
  if (!iso || iso.length < 16) return null;
  return iso.slice(11, 16);
}

/**
 * Derive real start/end/time_block from an rForce order's scheduled window.
 * Returns null when the order carries no usable time and the caller should fall
 * back to time-block defaults.
 *
 *  - Single-day window with a valid start < end → carry the exact rForce times:
 *      · measures (fixed_block) → time_block = the block containing the start hour
 *      · installs (full_day)    → time_block stays "full_day" (matches the type model)
 *      · timed types            → time_block = null
 *  - Multi-day window → a genuine full day: 08:00–16:00 / "full_day"
 *      (only for full-day types; other types fall back to defaults).
 *  - Missing / bogus (00:00 placeholder, start >= end) → null (fall back).
 */
export function deriveTimesFromOrder(
  scheduledStart: string | null | undefined,
  scheduledEnd: string | null | undefined,
  type: AppointmentType
): DerivedTimes | null {
  const rs = rforceWallClock(scheduledStart);
  if (!rs || rs === "00:00") return null;

  const startDate = scheduledStart!.slice(0, 10);
  const endDate = scheduledEnd ? scheduledEnd.slice(0, 10) : startDate;
  const sameDay = startDate === endDate;
  const mode = getSchedulingMode(type);

  if (!sameDay) {
    // A multi-day span occupies whole days; only full-day types model this.
    if (mode === "full_day") {
      return { start_time: "08:00", end_time: "16:00", time_block: "full_day" };
    }
    return null;
  }

  const re = rforceWallClock(scheduledEnd);
  if (!re || rs >= re) return null;

  let time_block: TimeBlock | null;
  if (mode === "fixed_block") {
    const hour = parseInt(rs.slice(0, 2), 10);
    time_block = Number.isNaN(hour) ? null : timeToBlock(hour);
  } else if (mode === "full_day") {
    time_block = "full_day";
  } else {
    time_block = null;
  }

  return { start_time: rs, end_time: re, time_block };
}
