/**
 * rForce Calendar Status — derives only the conditions the scheduler needs
 * from rForce data:
 *
 *   1. needs_confirmation — rForce says scheduled, no local appointment exists
 *   2. mismatch — linked local appointment disagrees with rForce
 *   3. awaiting_rforce — local appointment exists but rForce doesn't reflect
 *      that phase yet (booked in the app first); NOT a mismatch
 *   4. reference — ordinary tile display
 *
 * This replaces the general flag engine, fuzzy issue categories, stale-import
 * flags, etc. on the calendar execution path.
 */

import { Appointment, RForceOrder, AppointmentLink, Crew, ResourceMapping } from "./types";
import {
  getRForceResource,
  normalizeWoType,
  CANCELLED_STATUSES,
  COMPLETED_STATUSES,
} from "./normalize";
import {
  missedExportCount,
  MISSED_EXPORTS_FOR_NOT_IN_RFORCE,
  type AwaitingTier,
} from "./rforce-staleness";

/** Which 2-hour measure block an hour falls in. Local copy to avoid a circular
 *  import with calendar-utils (which imports from this module). */
function hourToBlock(hour: number): string {
  if (hour < 10) return "9-10";
  if (hour < 12) return "10-12";
  if (hour < 14) return "12-2";
  if (hour < 16) return "2-4";
  return "4-6";
}

export type RForceCalendarStatus =
  | "needs_confirmation"
  | "mismatch"
  | "awaiting_rforce"
  | "reference"
  | "synced";

export interface RForceMismatchDetails {
  date?: { app: string; rforce: string };
  time?: { app: string; rforce: string };
  crew?: { app: string; rforce: string };
  /** Day-count of the job: rForce span vs the scheduled appointment's duration.
   *  Flags e.g. a 2-day install booked for only 1 day. */
  duration?: { app: number; rforce: number };
}

export interface RForceCalendarItem {
  rforceOrder: RForceOrder;
  status: RForceCalendarStatus;
  linkedAppointment?: Appointment;
  mismatchDetails?: RForceMismatchDetails;
}

/**
 * Given a list of rForce orders and local appointments for a date range,
 * derive the calendar status for each rForce order.
 */
export function deriveRForceCalendarStatus(
  rforceOrders: RForceOrder[],
  appointments: Appointment[],
  activeLinks: AppointmentLink[],
  crews: Crew[] = [],
  mappings: ResourceMapping[] = []
): RForceCalendarItem[] {
  const normalizeWo = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase();
  // Build lookup: work_order_number → explicitly linked appointment (via links)
  const linkedByWo = new Map<string, Appointment>();
  for (const link of activeLinks) {
    if (link.unlinked_at) continue;
    const appt = appointments.find((a) => a.id === link.appointment_id);
    if (appt && appt.status !== "cancelled") {
      const normalizedWo = normalizeWo(link.work_order_number);
      if (normalizedWo) linkedByWo.set(normalizedWo, appt);
    }
  }
  // Also index by work_order_number directly (some appointments are linked by
  // WO field). A job's measure and install share one WO, so keep every
  // candidate and pick per rForce row below.
  const candidatesByWo = new Map<string, Appointment[]>();
  for (const appt of appointments) {
    if (appt.status === "cancelled" || !appt.work_order_number) continue;
    const normalizedWo = normalizeWo(appt.work_order_number);
    const list = candidatesByWo.get(normalizedWo) || [];
    list.push(appt);
    candidatesByWo.set(normalizedWo, list);
  }

  return rforceOrders.map((rf) => {
    const wo = normalizeWo(rf.work_order_number);
    // Pairing order: explicit link → the tile whose type matches this row's
    // phase (so the measure row pairs with the measure tile, not the install
    // booked on the same WO) → first tile on the WO (legacy behavior).
    const candidates = candidatesByWo.get(wo) || [];
    const rfPhase = normalizeWoType(rf.work_order_type);
    const linkedAppt =
      linkedByWo.get(wo) ??
      (rfPhase ? candidates.find((a) => a.appointment_type === rfPhase) : undefined) ??
      candidates[0];

    if (!linkedAppt) {
      // Only flag "needs_confirmation" if the rForce order is actually scheduled.
      // Unscheduled orders (no scheduled_start) are just reference data.
      const isScheduledInRForce = !!rf.scheduled_start && !!getRForceResource(rf);
      return {
        rforceOrder: rf,
        status: (isScheduledInRForce ? "needs_confirmation" : "reference") as RForceCalendarStatus,
      };
    }

    // Booked in the app before rForce caught up (no date, or rForce's single
    // row is still on an earlier phase). Comparing dates/times against the
    // wrong phase would only produce false mismatches.
    if (!isPhaseReflectedInRForce(rf, linkedAppt)) {
      return {
        rforceOrder: rf,
        status: "awaiting_rforce" as const,
        linkedAppointment: linkedAppt,
      };
    }

    // Has a linked appointment — check for mismatches
    const crewName = crews?.find((c) => c.id === linkedAppt.crew_id)?.name;
    const mismatch = detectMismatch(rf, linkedAppt, crewName, crews, mappings);
    if (mismatch) {
      return {
        rforceOrder: rf,
        status: "mismatch" as const,
        linkedAppointment: linkedAppt,
        mismatchDetails: mismatch,
      };
    }

    // In sync
    return {
      rforceOrder: rf,
      status: "synced" as const,
      linkedAppointment: linkedAppt,
    };
  });
}

function detectMismatch(
  rf: RForceOrder,
  appt: Appointment,
  crewName: string | undefined,
  crews: Crew[],
  mappings: ResourceMapping[]
): RForceMismatchDetails | null {
  const details: RForceMismatchDetails = {};
  let hasMismatch = false;

  // Date mismatch
  if (rf.scheduled_start && appt.scheduled_date) {
    const rfDate = rf.scheduled_start.slice(0, 10);
    if (rfDate !== appt.scheduled_date) {
      details.date = { app: appt.scheduled_date, rforce: rfDate };
      hasMismatch = true;
    }
  }

  // Time mismatch — block-aware. Measure appointments live in 2-hour blocks, so
  // a job is "on time" as long as the rForce time falls in the SAME block; only
  // a rForce time that lands in a DIFFERENT block is a real mismatch (wrong
  // window). This avoids false positives from block-vs-exact-minute differences
  // (e.g. rForce 10:30 in a 10–12 block). full_day work has no block to compare.
  if (rf.scheduled_start && appt.time_block && appt.time_block !== "full_day") {
    const rfHour = parseInt(rf.scheduled_start.slice(11, 13), 10);
    if (!Number.isNaN(rfHour)) {
      const rfBlock = hourToBlock(rfHour);
      if (rfBlock !== appt.time_block) {
        details.time = { app: appt.time_block, rforce: rfBlock };
        hasMismatch = true;
      }
    }
  }

  // Duration mismatch — the rForce order spans a different number of days than
  // the scheduled appointment (e.g. a 2-day install booked for only 1 day).
  if (rf.scheduled_start && appt.scheduled_date) {
    const rfStart = rf.scheduled_start.slice(0, 10);
    const rfEnd = (rf.scheduled_end || rf.scheduled_start).slice(0, 10);
    const rfDays = Math.max(
      1,
      Math.round((new Date(rfEnd).getTime() - new Date(rfStart).getTime()) / 86_400_000) + 1
    );
    const apptDays = Math.max(1, appt.duration_days || 1);
    if (rfDays !== apptDays) {
      details.duration = { app: apptDays, rforce: rfDays };
      hasMismatch = true;
    }
  }

  // Resource/crew mismatch
  const rfResource = getRForceResource(rf);
  if (rfResource && crewName && !resourceMatchesCrew(rfResource, appt.crew_id, crews, mappings)) {
    details.crew = { app: crewName, rforce: rfResource };
    hasMismatch = true;
  }

  return hasMismatch ? details : null;
}

function normalizeResource(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function resourceMatchesCrew(
  resourceName: string,
  crewId: string | null,
  crews: Crew[],
  mappings: ResourceMapping[]
): boolean {
  if (!crewId) return false;
  const normalized = normalizeResource(resourceName);
  const mappedCrewId = mappings.find(
    (mapping) => mapping.is_active && normalizeResource(mapping.raw_name) === normalized
  )?.crew_id;
  if (mappedCrewId) return mappedCrewId === crewId;

  const crew = crews.find((candidate) => candidate.id === crewId);
  if (!crew) return false;
  if (normalizeResource(crew.name) === normalized) return true;
  return (crew.aliases || []).some((alias) => normalizeResource(alias) === normalized);
}

// ── Awaiting rForce (booked in the app first) ──

/**
 * Does rForce's record reflect THIS appointment's phase? rForce keeps one row
 * per work order, so after the measure is done the row still says "Tech
 * Measure" with the measure's date until someone schedules the install there.
 *
 * Not reflected when the row has no scheduled date, or its type is a
 * recognized phase other than the appointment's. An unrecognized type is
 * treated as reflected (we can't tell, so fall through to normal comparison).
 */
export function isPhaseReflectedInRForce(rf: RForceOrder, appt: Appointment): boolean {
  if (!rf.scheduled_start || !getRForceResource(rf)) return false;
  const rfPhase = normalizeWoType(rf.work_order_type);
  return rfPhase === null || rfPhase === appt.appointment_type;
}

export type AwaitingRForceReason = "not_in_rforce" | "phase_not_scheduled";

export interface AppointmentRForceState {
  reason: AwaitingRForceReason;
  tier: AwaitingTier;
  /** Daily exports observed since the app last touched this appointment. */
  missedExports: number;
  /** The rForce row for the WO, when one exists (phase_not_scheduled only). */
  rforceOrder?: RForceOrder;
}

/**
 * Per-appointment "waiting on rForce" state — the single source for both the
 * Issues list and the calendar tile hint. Appointment-centric on purpose: the
 * rf→appointment pairing above is 1:1 per WO, so once the measure row pairs
 * with the measure tile, the install booked on the same WO isn't in any item.
 *
 * Returns null when the appointment isn't waiting on rForce (or isn't the
 * kind of tile that can be): unscheduled/cancelled/complete, past-dated, no
 * WO#, rForce cancelled it, or rForce already reflects this phase.
 *
 * Tier: `updated_at` is the "booked" anchor. Any later edit resets the clock,
 * which only under-escalates — the safe direction for an amber alert.
 */
export function deriveAppointmentRForceState(
  appt: Appointment,
  rfByWo: Map<string, RForceOrder>,
  exportDates: string[],
  todayISO: string
): AppointmentRForceState | null {
  if (
    appt.status === "cancelled" ||
    appt.status === "unscheduled" ||
    appt.status === "complete"
  )
    return null;
  if (!appt.scheduled_date || !appt.work_order_number) return null;
  // Only upcoming tiles — a past job that never made it into rForce is a
  // records question, not a scheduling one.
  if (appt.scheduled_date < todayISO) return null;

  const rf = rfByWo.get(appt.work_order_number.trim().toLowerCase());
  let reason: AwaitingRForceReason;
  if (!rf) {
    reason = "not_in_rforce";
  } else {
    const woS = rf.wo_status || "";
    const ordS = rf.order_status || "";
    // rForce cancelled it → the cancellation flows own this tile.
    if (CANCELLED_STATUSES.has(woS) || CANCELLED_STATUSES.has(ordS)) return null;
    // Completed only counts when it's THIS phase that's complete. A row closed
    // after the measure must still surface the install that was never entered.
    if (COMPLETED_STATUSES.has(woS) && normalizeWoType(rf.work_order_type) === appt.appointment_type)
      return null;
    if (isPhaseReflectedInRForce(rf, appt)) return null;
    reason = "phase_not_scheduled";
  }

  // Same counting primitive as the drop tiers, pointed the other way: exports
  // observed since the app last wrote this appointment. No export history yet
  // simply means nothing can be overdue — everything stays "pending".
  const missedExports = missedExportCount(appt, exportDates);
  const tier: AwaitingTier =
    missedExports >= MISSED_EXPORTS_FOR_NOT_IN_RFORCE ? "overdue" : "pending";

  return { reason, tier, missedExports, rforceOrder: rf };
}
