/**
 * Shared Schedule Command — the single entry point for moving/scheduling
 * appointments across Day, Week, Block views and the ScheduleModal.
 *
 * Every scheduling action flows through `executeScheduleMove()`.
 * Views must NOT construct their own partial updates and conflict checks.
 */

import { Appointment, AvailabilityRule, AvailabilityException, CalendarBlock, Crew, RForceOrder, TimeBlock } from "./types";
import {
  getSchedulingMode,
  coerceFixedBlock,
  isValidTimeRange,
  snapTo30Min,
  addMinutesToTime,
  timeDurationMinutes,
  deriveOccupancy,
} from "./scheduling-policy";
import { MEASURE_TIME_BLOCKS, timeBlockStartEnd } from "./calendar-utils";
import { checkSchedulingConflicts, formatConflictMessage } from "./scheduling-validation";
import { checkAvailabilityConflict } from "./availability";
import { getEligibleCrews } from "./crew-utils";
import { getRForceResource } from "./normalize";
import { createAppointmentEvent } from "./store";

/** Which 2-hour measure block an hour lands in. */
function hourToFixedBlock(hour: number): TimeBlock {
  if (hour < 10) return "9-10";
  if (hour < 12) return "10-12";
  if (hour < 14) return "12-2";
  if (hour < 16) return "2-4";
  return "4-6";
}

// ── Types ──

export interface ScheduleMoveTarget {
  /** The appointment being moved. */
  appointmentId: string;
  /** Optimistic concurrency version. */
  expectedVersion: number;
  /** Target crew/resource. */
  crewId: string;
  /** Target date (YYYY-MM-DD). */
  scheduledDate: string;
  /** For fixed_block types (measures). */
  timeBlock?: TimeBlock | null;
  timeBlockEnd?: TimeBlock | null;
  /** For timed types — explicit start. */
  startTime?: string | null;
  /** For timed types — explicit end. */
  endTime?: string | null;
  /**
   * Day-view drag: keep the EXACT dropped time even for fixed_block (measure)
   * appointments, and derive the block from it — instead of snapping to the
   * block start. Lets a measure job hold a genuine time when it really has one.
   */
  exactTime?: boolean;
  /** Multi-day install duration. */
  durationDays?: number;
  /**
   * Explicit all-day flag from the full-day checkbox. Overrides the type default
   * (installs default true, timed types false). When true the job occupies the
   * whole day; when false a full-day-default type (install) becomes a timed job.
   */
  isFullDay?: boolean;
  /**
   * Scheduler-set duration in hours. When a timed job is placed with a start but
   * no explicit end, the end is start + resourceHours. Ignored for full-day work.
   */
  resourceHours?: number | null;
  /**
   * Intentional same-slot overlap. When true, the client-side conflict check is
   * skipped and the appointment is tagged `allow_overlap` so the DB guards let it
   * share an already-booked slot. Set only after the scheduler explicitly
   * confirms the double-book.
   */
  allowOverlap?: boolean;
  /**
   * Intentional booking onto a blocked availability window (PTO / Unavailable /
   * Late Day / Office Day). When true, the availability pre-check is skipped and
   * the appointment is tagged `allow_availability_conflict` so the flag is
   * suppressed. Set only after the scheduler confirms the override.
   */
  allowAvailabilityConflict?: boolean;
  /** Non-scheduling fields that must be committed atomically with the move. */
  additionalUpdates?: Partial<Appointment>;
  /** Audit action/reason for explicit reschedules and edits. */
  auditAction?: "drag_moved" | "drag_resized" | "rescheduled" | "updated";
  reason?: string | null;
}

export type ScheduleErrorCode =
  | "NOT_FOUND"
  | "INELIGIBLE_CREW"
  | "INVALID_TIME_RANGE"
  | "SCHEDULING_CONFLICT"
  | "AVAILABILITY_CONFLICT"
  | "VERSION_CONFLICT"
  | "DOUBLE_BOOK"
  | "DUPLICATE_WO"
  | "DB_ERROR";

export interface ScheduleError {
  code: ScheduleErrorCode;
  message: string;
}

export type ScheduleMoveResult =
  | { ok: true; appointment: Appointment }
  | { ok: false; error: ScheduleError };

// ── Pre-move validation (client-side) ──

/**
 * Validate a proposed move BEFORE persisting.
 * Returns null if valid, or a ScheduleError if invalid.
 */
export function validateMove(
  target: ScheduleMoveTarget,
  currentAppointment: Appointment,
  allAppointments: Appointment[],
  allCrews: Crew[],
  availabilityRules: AvailabilityRule[] = [],
  availabilityExceptions: AvailabilityException[] = [],
  calendarBlocks: CalendarBlock[] = []
): ScheduleError | null {
  // 1. Check crew eligibility
  const eligible = getEligibleCrews(allCrews, currentAppointment.appointment_type);
  if (!eligible.find((c) => c.id === target.crewId)) {
    const crew = allCrews.find((c) => c.id === target.crewId);
    return {
      code: "INELIGIBLE_CREW",
      message: `${crew?.name || "Selected crew"} cannot handle ${currentAppointment.appointment_type.replace(/_/g, " ")} appointments`,
    };
  }

  // 2. Resolve exactly what this move would store — times, block, and the
  // multi-block span — so the checks below judge the real footprint rather than
  // a looser approximation. (Checking only the first block of a spanning
  // measure once let it land on top of another crew's job unnoticed.)
  const resolved = resolveMoveTimes(target, currentAppointment);
  if (!isValidTimeRange(resolved.startTime, resolved.endTime)) {
    return { code: "INVALID_TIME_RANGE", message: "End time must be after start time." };
  }

  // 3. Conflict check — skipped when the scheduler has explicitly opted into an
  // intentional same-slot overlap (allow_overlap). The DB guards likewise skip
  // rows tagged allow_overlap, so the double-book is placed on purpose.
  const durationDays = target.durationDays ?? currentAppointment.duration_days ?? 1;
  const blockForCheck: TimeBlock | null = resolved.timeBlock;
  if (!target.allowOverlap && blockForCheck) {
    const conflicts = checkSchedulingConflicts(
      target.crewId,
      target.scheduledDate,
      durationDays,
      blockForCheck,
      resolved.timeBlockEnd,
      allAppointments,
      target.appointmentId,
    );
    if (conflicts.length > 0) {
      return {
        code: "SCHEDULING_CONFLICT",
        message: formatConflictMessage(conflicts[0]),
      };
    }
  }

  // 4. Availability check — booking onto a blocked window (PTO / Unavailable /
  // Late or Office day) requires an explicit override, just like double-booking.
  if (!target.allowAvailabilityConflict && (availabilityRules.length > 0 || calendarBlocks.length > 0)) {
    const block = checkAvailabilityConflict(
      target.crewId,
      target.scheduledDate,
      durationDays,
      blockForCheck,
      resolved.timeBlockEnd,
      availabilityRules,
      availabilityExceptions,
      calendarBlocks,
    );
    if (block) {
      const crewName = allCrews.find((c) => c.id === target.crewId)?.name || "This crew";
      return {
        code: "AVAILABILITY_CONFLICT",
        message: block.fullDay
          ? `${crewName} is ${block.reason} on ${block.date} (whole day blocked).`
          : `${crewName} is ${block.reason} during this time on ${block.date}.`,
      };
    }
  }

  return null;
}

/** Everything a move will store about WHEN the job sits. */
export interface ResolvedMoveTimes {
  startTime: string;
  endTime: string;
  timeBlock: TimeBlock | null;
  /** Last block of a multi-block measure span, or null for a single block. */
  timeBlockEnd: TimeBlock | null;
  wantsFullDay: boolean;
}

/**
 * Where a multi-block measure's span ends after a move. An explicit
 * `target.timeBlockEnd` always wins (null clears it). Otherwise: same start
 * block → keep the span (a crew or date change); a new start block → slide the
 * span by the same number of blocks when it still fits the grid, else drop it.
 * Never returns an end at or before the start — that inverted span used to
 * vanish from the grid and from every conflict check.
 */
function resolveBlockSpan(
  target: ScheduleMoveTarget,
  current: Appointment,
  timeBlock: TimeBlock | null
): TimeBlock | null {
  if (!timeBlock || timeBlock === "full_day") return null;
  const startIdx = MEASURE_TIME_BLOCKS.indexOf(timeBlock);
  if (startIdx < 0) return null;

  let end: TimeBlock | null;
  if (target.timeBlockEnd !== undefined) {
    end = target.timeBlockEnd;
  } else if (!current.time_block_end || !current.time_block) {
    end = null;
  } else if (current.time_block === timeBlock) {
    end = current.time_block_end;
  } else {
    const delta = startIdx - MEASURE_TIME_BLOCKS.indexOf(current.time_block);
    const shifted = MEASURE_TIME_BLOCKS.indexOf(current.time_block_end) + delta;
    end = shifted >= 0 && shifted < MEASURE_TIME_BLOCKS.length ? MEASURE_TIME_BLOCKS[shifted] : null;
  }
  if (!end) return null;
  return MEASURE_TIME_BLOCKS.indexOf(end) > startIdx ? end : null;
}

/**
 * Resolve the times, block, and span a move will store. Shared by the pre-move
 * validation and the update builder so both judge the SAME footprint — a
 * mismatch between the two is how a spanning measure once slipped past the
 * conflict check.
 */
export function resolveMoveTimes(
  target: ScheduleMoveTarget,
  currentAppointment: Appointment
): ResolvedMoveTimes {
  const mode = getSchedulingMode(currentAppointment.appointment_type);
  // Whether this move is all-day. The checkbox (target.isFullDay) wins; otherwise
  // only genuine full-day-mode types (installs/LSWP) default to all-day. Measures
  // are never all-day.
  const wantsFullDay = mode === "fixed_block" ? false : (target.isFullDay ?? mode === "full_day");

  let startTime: string;
  let endTime: string;
  let timeBlock: TimeBlock | null;

  if (wantsFullDay) {
    // All-day work occupies the standard workday; time_block stays the full-day
    // placement key so the week/block grid keeps rendering it in the install row.
    // A caller's own window is honoured only when it is a real forward window —
    // a timed job flipped to full-day from a 17:00 start would otherwise store
    // 17:00–16:00.
    const start = target.startTime;
    const end = target.endTime || "16:00";
    if (start && isValidTimeRange(start, end)) {
      startTime = start;
      endTime = end;
    } else {
      startTime = "08:00";
      endTime = "16:00";
    }
    timeBlock = "full_day";
  } else if (mode === "fixed_block" && target.exactTime && target.startTime) {
    // Day-view exact-time drop for a measure job: keep the precise time and
    // derive which block it lands in.
    const origDuration = timeDurationMinutes(
      currentAppointment.start_time || "10:00",
      currentAppointment.end_time || "12:00"
    );
    startTime = snapTo30Min(target.startTime);
    endTime = target.endTime || addMinutesToTime(startTime, origDuration);
    timeBlock = hourToFixedBlock(parseInt(startTime.slice(0, 2), 10));
  } else if (mode === "fixed_block") {
    // Block-grid placement, or a crew/date move that keeps the block. A measure
    // is never full_day; a missing block falls back to the first measure block.
    timeBlock = coerceFixedBlock(
      currentAppointment.appointment_type,
      target.timeBlock ?? currentAppointment.time_block
    );
    const window = timeBlockStartEnd(timeBlock);
    startTime = window.start;
    endTime = window.end;
  } else if (target.startTime) {
    // Timed placement (service/JIP/…, or a full-day-default type with the box
    // unchecked). Honour an explicit end, else a scheduler-set hour count, else
    // preserve the original duration.
    const origDuration = timeDurationMinutes(
      currentAppointment.start_time || "08:00",
      currentAppointment.end_time || "09:00"
    );
    startTime = snapTo30Min(target.startTime);
    if (target.endTime) {
      endTime = target.endTime;
    } else if (target.resourceHours && target.resourceHours > 0) {
      endTime = addMinutesToTime(startTime, Math.round(target.resourceHours * 60));
    } else {
      endTime = addMinutesToTime(startTime, origDuration);
    }
    timeBlock = null; // timed jobs don't sit in the measure block grid
  } else {
    // No explicit start (e.g. block-grid move of a non-full-day timed job) —
    // preserve existing times, drop any stale full-day block tag.
    startTime = currentAppointment.start_time || "08:00";
    endTime = target.endTime || currentAppointment.end_time || "09:00";
    if (target.resourceHours && target.resourceHours > 0 && startTime) {
      endTime = addMinutesToTime(startTime, Math.round(target.resourceHours * 60));
    }
    timeBlock = null;
  }

  // A spanning measure ends at the end of its LAST block, not its first —
  // otherwise the stored window (and the DB's interval check) covered only
  // block one while the grid drew all of them.
  const timeBlockEnd = resolveBlockSpan(target, currentAppointment, timeBlock);
  if (timeBlockEnd) endTime = timeBlockStartEnd(timeBlockEnd).end;

  return { startTime, endTime, timeBlock, timeBlockEnd, wantsFullDay };
}

/**
 * Build the partial update object for a scheduling move.
 * This is what gets passed to `updateAppointment()`.
 */
export function buildMoveUpdates(
  target: ScheduleMoveTarget,
  currentAppointment: Appointment,
  allCrews: Crew[],
  rforceOrders?: RForceOrder[]
): Partial<Appointment> {
  const { startTime, endTime, timeBlock, timeBlockEnd, wantsFullDay } =
    resolveMoveTimes(target, currentAppointment);

  // Check for manual override (rForce mismatch)
  let manualOverride = currentAppointment.manual_override;
  let overrideSource = currentAppointment.override_source;

  if (currentAppointment.work_order_number && rforceOrders) {
    const rf = rforceOrders.find(
      (r) => r.work_order_number === currentAppointment.work_order_number
    );
    if (rf && rf.scheduled_start) {
      const rfDate = rf.scheduled_start.slice(0, 10);
      const rfResource = getRForceResource(rf);
      const targetCrew = allCrews.find((c) => c.id === target.crewId);

      // Compare TARGET position against rForce (not current position)
      const targetMatchesRForceDate = target.scheduledDate === rfDate;
      const targetMatchesRForceCrew = !rfResource || !targetCrew ||
        targetCrew.name.toLowerCase() === rfResource.toLowerCase();

      if (!targetMatchesRForceDate || !targetMatchesRForceCrew) {
        // Moving away from rForce position → manual override
        manualOverride = true;
        overrideSource = {
          crew_name: rfResource || undefined,
          scheduled_date: rfDate,
          time_block: currentAppointment.time_block || undefined,
        };
      } else {
        // Moving back to match rForce → clear override
        manualOverride = false;
        overrideSource = null;
      }
    }
  }

  const occupancy = deriveOccupancy({
    timeBlock,
    startTime,
    endTime,
    fullDay: wantsFullDay,
  });

  return {
    crew_id: target.crewId,
    scheduled_date: target.scheduledDate,
    time_block: timeBlock,
    // Resolved alongside the times (see resolveBlockSpan): kept, slid, or
    // cleared with the block; always null once a job leaves the measure grid.
    time_block_end: timeBlockEnd,
    // Placing a queued tile is what schedules it — without this the row kept
    // status 'unscheduled' and stayed in the queue after landing on the calendar.
    ...(currentAppointment.status === "unscheduled" ? { status: "scheduled" as const } : {}),
    start_time: startTime,
    end_time: endTime,
    is_full_day: occupancy.is_full_day,
    resource_hours: occupancy.resource_hours,
    duration_days: target.durationDays ?? currentAppointment.duration_days,
    manual_override: manualOverride,
    override_source: overrideSource,
    // Tag only when this move is an intentional overlap. A normal move into a
    // free slot clears the flag so the appointment is fully guarded again.
    allow_overlap: !!target.allowOverlap,
    // Likewise for an intentional booking onto a blocked availability window;
    // a normal move onto an open slot clears it.
    allow_availability_conflict: !!target.allowAvailabilityConflict,
  };
}

/**
 * Execute a scheduling move through the shared command.
 *
 * This is the ONE function all views call. It:
 * 1. Validates the move
 * 2. Builds the update
 * 3. Persists via updateAppointment
 * 4. Records the audit event
 * 5. Updates sync state if linked
 *
 * Returns a typed result — never throws.
 */
export async function executeScheduleMove(
  target: ScheduleMoveTarget,
  currentAppointment: Appointment,
  allAppointments: Appointment[],
  allCrews: Crew[],
  rforceOrders: RForceOrder[],
  updateAppointment: (id: string, version: number, updates: Partial<Appointment>) => Promise<Appointment | null>,
  actor: { id: string | null; name: string | null },
  availabilityRules: AvailabilityRule[] = [],
  availabilityExceptions: AvailabilityException[] = [],
  calendarBlocks: CalendarBlock[] = []
): Promise<ScheduleMoveResult> {
  // 1. Validate
  const validationError = validateMove(
    target,
    currentAppointment,
    allAppointments,
    allCrews,
    availabilityRules,
    availabilityExceptions,
    calendarBlocks,
  );
  if (validationError) {
    return { ok: false, error: validationError };
  }

  // 2. Build updates
  const schedulingUpdates = buildMoveUpdates(target, currentAppointment, allCrews, rforceOrders);
  const updates = { ...schedulingUpdates, ...(target.additionalUpdates || {}) };

  // 3. Check for no-op. Overlap / availability overrides must always persist
  // (they flip allow_overlap / allow_availability_conflict), so exclude them —
  // otherwise confirming an override reports success but writes nothing.
  if (
    updates.crew_id === currentAppointment.crew_id &&
    updates.scheduled_date === currentAppointment.scheduled_date &&
    updates.start_time === currentAppointment.start_time &&
    updates.end_time === currentAppointment.end_time &&
    updates.time_block === currentAppointment.time_block &&
    updates.time_block_end === currentAppointment.time_block_end &&
    !!updates.allow_overlap === !!currentAppointment.allow_overlap &&
    !!updates.allow_availability_conflict === !!currentAppointment.allow_availability_conflict &&
    !target.additionalUpdates
  ) {
    return { ok: true, appointment: currentAppointment };
  }

  // 4. Persist
  try {
    const result = await updateAppointment(
      target.appointmentId,
      target.expectedVersion,
      updates
    );
    if (!result) {
      return {
        ok: false,
        error: { code: "DB_ERROR", message: "Update returned no data" },
      };
    }

    // 5. Audit event (fire-and-forget)
    createAppointmentEvent({
      appointment_id: target.appointmentId,
      action: target.auditAction || "drag_moved",
      actor_id: actor.id,
      actor_name_snapshot: actor.name,
      before_state: {
        crew_id: currentAppointment.crew_id,
        scheduled_date: currentAppointment.scheduled_date,
        start_time: currentAppointment.start_time,
        end_time: currentAppointment.end_time,
        time_block: currentAppointment.time_block,
      },
      after_state: {
        crew_id: updates.crew_id,
        scheduled_date: updates.scheduled_date,
        start_time: updates.start_time,
        end_time: updates.end_time,
        time_block: updates.time_block,
      },
      reason: target.reason || null,
    }).catch(() => {}); // never block on audit

    return { ok: true, appointment: result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg === "VERSION_CONFLICT") {
      return {
        ok: false,
        error: {
          code: "VERSION_CONFLICT",
          message: "Someone else just updated this appointment — please try again",
        },
      };
    }
    // Checked before the conflict branch: the DB raises this for an end-before-
    // start window, and it must surface as a plain error — never as an overlap
    // the scheduler could "book anyway" into existence.
    if (msg.includes("INVALID_TIME_RANGE")) {
      return {
        ok: false,
        error: { code: "INVALID_TIME_RANGE", message: "End time must be after start time." },
      };
    }
    if (msg === "DOUBLE_BOOK" || msg.includes("SCHEDULING_CONFLICT")) {
      return {
        ok: false,
        error: { code: "SCHEDULING_CONFLICT", message: "That resource is already booked during the selected time" },
      };
    }
    if (msg.includes("DUPLICATE_WO") || msg.includes("idx_unique_active_work_order")) {
      return {
        ok: false,
        error: { code: "DUPLICATE_WO", message: "An active appointment already exists for that work order" },
      };
    }
    return {
      ok: false,
      error: { code: "DB_ERROR", message: msg },
    };
  }
}
