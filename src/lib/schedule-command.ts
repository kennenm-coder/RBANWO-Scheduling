/**
 * Shared Schedule Command — the single entry point for moving/scheduling
 * appointments across Day, Week, Block views and the ScheduleModal.
 *
 * Every scheduling action flows through `executeScheduleMove()`.
 * Views must NOT construct their own partial updates and conflict checks.
 */

import { Appointment, Crew, RForceOrder, TimeBlock } from "./types";
import {
  getSchedulingMode,
  resolveScheduleTimes,
  snapTo30Min,
  addMinutesToTime,
  timeDurationMinutes,
} from "./scheduling-policy";
import { checkSchedulingConflicts, formatConflictMessage } from "./scheduling-validation";
import { getEligibleCrews } from "./crew-utils";
import { createAppointmentEvent } from "./store";

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
  /** Multi-day install duration. */
  durationDays?: number;
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
  allCrews: Crew[]
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

  // 3. Conflict check
  const durationDays = target.durationDays ?? currentAppointment.duration_days ?? 1;
  if (resolved.timeBlock || mode === "timed") {
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

  // Resolve times
  let startTime: string;
  let endTime: string;
  let timeBlock: TimeBlock | null;

  if (mode === "fixed_block" && target.timeBlock) {
    const resolved = resolveScheduleTimes(currentAppointment.appointment_type, {
      timeBlock: target.timeBlock,
    });
    startTime = resolved.start;
    endTime = resolved.end;
    timeBlock = resolved.timeBlock;
  } else if (mode === "timed" && target.startTime) {
    // Preserve original duration when moving timed appointments
    const origDuration = timeDurationMinutes(
      currentAppointment.start_time || "08:00",
      currentAppointment.end_time || "17:00"
    );
    startTime = snapTo30Min(target.startTime);
    endTime = target.endTime || addMinutesToTime(startTime, origDuration);
    timeBlock = target.timeBlock || currentAppointment.time_block;
  } else if (mode === "full_day") {
    const resolved = resolveScheduleTimes(currentAppointment.appointment_type, {
      startTime: target.startTime,
      endTime: target.endTime,
    });
    startTime = resolved.start;
    endTime = resolved.end;
    timeBlock = "full_day";
  } else {
    // Fallback — preserve existing times
    startTime = target.startTime || currentAppointment.start_time || "08:00";
    endTime = target.endTime || currentAppointment.end_time || "17:00";
    timeBlock = target.timeBlock ?? currentAppointment.time_block;
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

  return {
    crew_id: target.crewId,
    scheduled_date: target.scheduledDate,
    time_block: timeBlock,
    time_block_end: target.timeBlockEnd ?? currentAppointment.time_block_end,
    start_time: startTime,
    end_time: endTime,
    duration_days: target.durationDays ?? currentAppointment.duration_days,
    manual_override: manualOverride,
    override_source: overrideSource,
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
  actor: { id: string | null; name: string | null }
): Promise<ScheduleMoveResult> {
  // 1. Validate
  const validationError = validateMove(target, currentAppointment, allAppointments, allCrews);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  // 2. Build updates
  const schedulingUpdates = buildMoveUpdates(target, currentAppointment, allCrews, rforceOrders);
  const updates = { ...schedulingUpdates, ...(target.additionalUpdates || {}) };

  // 3. Check for no-op
  if (
    updates.crew_id === currentAppointment.crew_id &&
    updates.scheduled_date === currentAppointment.scheduled_date &&
    updates.start_time === currentAppointment.start_time &&
    updates.end_time === currentAppointment.end_time &&
    updates.time_block === currentAppointment.time_block &&
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
