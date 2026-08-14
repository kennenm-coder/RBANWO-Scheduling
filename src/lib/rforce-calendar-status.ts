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

export type RForceCalendarStatus = "needs_confirmation" | "mismatch" | "reference" | "synced";

export interface RForceMismatchDetails {
  date?: { app: string; rforce: string };
  time?: { app: string; rforce: string };
  crew?: { app: string; rforce: string };
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

  // Time mismatch
  if (rf.scheduled_start && appt.start_time) {
    const rfTime = rf.scheduled_start.slice(11, 16);
    if (rfTime && appt.start_time && rfTime !== appt.start_time) {
      details.time = { app: appt.start_time, rforce: rfTime };
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
