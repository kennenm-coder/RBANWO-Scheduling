/**
 * rForce Calendar Status — derives only the two conditions the scheduler
 * needs from rForce data:
 *
 *   1. needs_confirmation — rForce says scheduled, no local appointment exists
 *   2. mismatch — linked local appointment disagrees with rForce
 *   3. reference — ordinary tile display
 *
 * This replaces the general flag engine, fuzzy issue categories, stale-import
 * flags, etc. on the calendar execution path.
 */

import { Appointment, RForceOrder, AppointmentLink, Crew, ResourceMapping } from "./types";

/** Which 2-hour measure block an hour falls in. Local copy to avoid a circular
 *  import with calendar-utils (which imports from this module). */
function hourToBlock(hour: number): string {
  if (hour < 10) return "9-10";
  if (hour < 12) return "10-12";
  if (hour < 14) return "12-2";
  if (hour < 16) return "2-4";
  return "4-6";
}

export type RForceCalendarStatus = "needs_confirmation" | "mismatch" | "reference" | "synced";

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
  // Build lookup: work_order_number → appointment (via links)
  const woToAppointment = new Map<string, Appointment>();
  for (const link of activeLinks) {
    if (link.unlinked_at) continue;
    const appt = appointments.find((a) => a.id === link.appointment_id);
    if (appt && appt.status !== "cancelled") {
      const normalizedWo = normalizeWo(link.work_order_number);
      if (normalizedWo) woToAppointment.set(normalizedWo, appt);
    }
  }
  // Also check by work_order_number directly (some appointments are linked by WO field)
  for (const appt of appointments) {
    if (appt.status === "cancelled" || !appt.work_order_number) continue;
    const normalizedWo = normalizeWo(appt.work_order_number);
    if (!woToAppointment.has(normalizedWo)) {
      woToAppointment.set(normalizedWo, appt);
    }
  }

  return rforceOrders.map((rf) => {
    const linkedAppt = woToAppointment.get(normalizeWo(rf.work_order_number));

    if (!linkedAppt) {
      // Only flag "needs_confirmation" if the rForce order is actually scheduled.
      // Unscheduled orders (no scheduled_start) are just reference data.
      const isScheduledInRForce = !!rf.scheduled_start;
      return {
        rforceOrder: rf,
        status: (isScheduledInRForce ? "needs_confirmation" : "reference") as RForceCalendarStatus,
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
  const rfResource = rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
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
