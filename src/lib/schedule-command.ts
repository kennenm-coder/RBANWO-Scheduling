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
  resolveScheduleTimes,
  snapTo30Min,
  addMinutesToTime,
  timeDurationMinutes,
  deriveOccupancy,
} from "./scheduling-policy";
import { checkSchedulingConflicts, formatConflictMessage } from "./scheduling-validation";
import { checkAvailabilityConflict } from "./availability";
import { getEligibleCrews } from "./crew-utils";
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

  // 2. Resolve times based on scheduling mode
  const mode = getSchedulingMode(currentAppointment.appointment_type);
  const resolved = resolveScheduleTimes(currentAppointment.appointment_type, {
    timeBlock: target.timeBlock,
    startTime: target.startTime,
    endTime: target.endTime,
  });

  // 3. Conflict check — skipped when the scheduler has explicitly opted into an
  // intentional same-slot overlap (allow_overlap). The DB guards likewise skip
  // rows tagged allow_overlap, so the double-book is placed on purpose.
  const durationDays = target.durationDays ?? currentAppointment.duration_days ?? 1;
  if (!target.allowOverlap && (resolved.timeBlock || mode === "timed")) {
    const blockForCheck = resolved.timeBlock || (mode === "full_day" ? "full_day" : null);
    if (blockForCheck) {
      const conflicts = checkSchedulingConflicts(
        target.crewId,
        target.scheduledDate,
        durationDays,
        blockForCheck,
        target.timeBlockEnd ?? null,
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
  }

  // 4. Availability check — booking onto a blocked window (PTO / Unavailable /
  // Late or Office day) requires an explicit override, just like double-booking.
  if (!target.allowAvailabilityConflict && (availabilityRules.length > 0 || calendarBlocks.length > 0)) {
    const blockForCheck: TimeBlock | null =
      resolved.timeBlock || (mode === "full_day" ? "full_day" : null);
    const block = checkAvailabilityConflict(
      target.crewId,
      target.scheduledDate,
      durationDays,
      blockForCheck,
      target.timeBlockEnd ?? null,
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
  const mode = getSchedulingMode(currentAppointment.appointment_type);
  // Whether this move is all-day. The checkbox (target.isFullDay) wins; otherwise
  // only genuine full-day-mode types (installs/LSWP) default to all-day. Measures
  // are never all-day.
  const wantsFullDay = mode === "fixed_block" ? false : (target.isFullDay ?? mode === "full_day");

  // Resolve times
  let startTime: string;
  let endTime: string;
  let timeBlock: TimeBlock | null;

  if (wantsFullDay) {
    // All-day work occupies the standard workday; time_block stays the full-day
    // placement key so the week/block grid keeps rendering it in the install row.
    startTime = target.startTime || "08:00";
    endTime = target.endTime || "16:00";
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
  } else if (mode === "fixed_block" && target.timeBlock) {
    const resolved = resolveScheduleTimes(currentAppointment.appointment_type, {
      timeBlock: target.timeBlock,
    });
    startTime = resolved.start;
    endTime = resolved.end;
    timeBlock = resolved.timeBlock;
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
    startTime = target.startTime || currentAppointment.start_time || "08:00";
    endTime = target.endTime || currentAppointment.end_time || "09:00";
    if (target.resourceHours && target.resourceHours > 0 && startTime) {
      endTime = addMinutesToTime(startTime, Math.round(target.resourceHours * 60));
    }
    timeBlock = mode === "fixed_block" ? (target.timeBlock ?? currentAppointment.time_block) : null;
  }

  // Check for manual override (rForce mismatch)
  let manualOverride = currentAppointment.manual_override;
  let overrideSource = currentAppointment.override_source;

  if (currentAppointment.work_order_number && rforceOrders) {
    const rf = rforceOrders.find(
      (r) => r.work_order_number === currentAppointment.work_order_number
    );
    if (rf && rf.scheduled_start) {
      const rfDate = rf.scheduled_start.slice(0, 10);
      const rfResource = rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
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
    // A block span only makes sense for measures; clear it for everyone else so a
    // stale span can't linger when a job leaves the measure grid.
    time_block_end: timeBlock && timeBlock !== "full_day"
      ? (target.timeBlockEnd ?? currentAppointment.time_block_end)
      : null,
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
