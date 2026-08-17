/**
 * Shared timeline-drag math for the Day view.
 *
 * ONE calculation is used for both the (future) live drag preview and the final
 * drop, so what the user sees is exactly what gets saved. Keeping this pure and
 * dependency-free makes it unit-testable and reusable by the eventual
 * pointer/@dnd-kit rebuild.
 *
 * Everything works in "minutes since midnight" internally. Coordinates are
 * viewport-based (`clientX` + `getBoundingClientRect()`), so horizontal
 * scrolling is already reflected in the lane rectangle — never mix in pageX /
 * offsetX / scrollLeft.
 */

/** Day-view snap granularity. Preview and final drop MUST share this. */
export const DAY_VIEW_SNAP_MINUTES = 15;

export interface TimelineDragInput {
  /** Pointer viewport X (clientX). */
  pointerClientX: number;
  /** Lane rectangle left edge, viewport coords (rect.left). */
  laneLeft: number;
  /** Lane rectangle width in px (rect.width). */
  laneWidth: number;
  /** Timeline start, minutes since midnight (e.g. 04:00 → 240). */
  timelineStartMinutes: number;
  /** Timeline end, minutes since midnight (e.g. 22:00 → 1320). */
  timelineEndMinutes: number;
  /** Appointment length in minutes; preserved by the move. */
  appointmentDurationMinutes: number;
  /** How far (in minutes) into the card the user grabbed. Prevents jumping. */
  grabOffsetMinutes: number;
  /** Snap granularity in minutes. */
  snapMinutes: number;
}

export interface TimelineDragResult {
  startMinutes: number;
  endMinutes: number;
  /** "HH:MM" 24h — safe to persist. */
  startTime: string;
  endTime: string;
  /** Left offset as a % of the lane width (matches the card positioning math). */
  leftPercent: number;
  /** Width as a % of the lane width. */
  widthPercent: number;
  /** True when the duration cannot fit inside the timeline (caller should defer to the reschedule modal). */
  overflowsTimeline: boolean;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Parse "HH:MM" (or "HH:MM:SS") into minutes since midnight. */
export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Format minutes since midnight into a safe "HH:MM" 24h string. */
export function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Duration in minutes between two "HH:MM" times (may be negative if malformed). */
export function getDurationMinutes(start: string, end: string): number {
  return parseTimeToMinutes(end) - parseTimeToMinutes(start);
}

/**
 * Given the pointer position over a timeline lane, compute the snapped start/end
 * for the dragged appointment, preserving its duration and the grab offset.
 *
 * Throws a RangeError for a non-positive duration or non-positive lane width —
 * the caller should treat that as "cannot resolve a time" and cancel / open the
 * reschedule modal rather than inventing a fallback.
 */
export function calculateTimelineDrag(input: TimelineDragInput): TimelineDragResult {
  const {
    pointerClientX,
    laneLeft,
    laneWidth,
    timelineStartMinutes,
    timelineEndMinutes,
    appointmentDurationMinutes,
    grabOffsetMinutes,
    snapMinutes,
  } = input;

  if (!(appointmentDurationMinutes > 0)) {
    throw new RangeError(`Invalid appointment duration: ${appointmentDurationMinutes}`);
  }
  if (!(laneWidth > 0)) {
    throw new RangeError(`Invalid lane width: ${laneWidth}`);
  }
  if (!(snapMinutes > 0)) {
    throw new RangeError(`Invalid snap interval: ${snapMinutes}`);
  }

  const span = timelineEndMinutes - timelineStartMinutes;

  // Pointer → minutes on the timeline. clientX and rect.left are both viewport
  // coordinates, so scroll is already accounted for.
  const pointerRatio = (pointerClientX - laneLeft) / laneWidth;
  const pointerMinutes = timelineStartMinutes + pointerRatio * span;

  // Subtract where inside the card the user grabbed so the card doesn't jump.
  const unsnappedStart = pointerMinutes - grabOffsetMinutes;
  const snappedStart = Math.round(unsnappedStart / snapMinutes) * snapMinutes;

  // The latest start that still fits the whole appointment on the timeline.
  const latestStart = timelineEndMinutes - appointmentDurationMinutes;
  const overflowsTimeline = latestStart < timelineStartMinutes;

  // When the appointment is longer than the timeline, latestStart < start; the
  // lower bound wins and the caller is expected to defer via overflowsTimeline.
  const startMinutes = clamp(
    snappedStart,
    timelineStartMinutes,
    Math.max(timelineStartMinutes, latestStart)
  );
  const endMinutes = startMinutes + appointmentDurationMinutes;

  return {
    startMinutes,
    endMinutes,
    startTime: minutesToTime(startMinutes),
    endTime: minutesToTime(endMinutes),
    leftPercent: ((startMinutes - timelineStartMinutes) / span) * 100,
    widthPercent: (appointmentDurationMinutes / span) * 100,
    overflowsTimeline,
  };
}
