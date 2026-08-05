import { Appointment, AppointmentLink, Crew, RForceOrder, TimeBlock, TimeOffRequest } from "./types";
import { getTimeOffForDate } from "./store";

export type FlagSeverity = "error" | "warning" | "info";

export interface FlagDifferences {
  date?: { app: string; rforce: string };
  time?: { app: string; rforce: string };
  crew?: { app: string; rforce: string };
  type?: { app: string; rforce: string };
}

export interface Flag {
  id: string;
  type: "time_off_conflict" | "double_booking" | "discrepancy" | "missing_address" | "manual" | "manual_override" | "unlinked";
  severity: FlagSeverity;
  message: string;
  appointmentId?: string;
  crewId?: string;
  date?: string;
  differences?: FlagDifferences;
}

/** Map a TimeBlock to the expected rForce scheduled_start hour. */
const TIME_BLOCK_HOUR: Record<TimeBlock, number> = {
  "9-10": 9,
  "10-12": 10,
  "12-2": 12,
  "2-4": 14,
  "4-6": 16,
  full_day: 8,
};

/** Map rForce work_order_type strings to our AppointmentType values. */
const WO_TYPE_MAP: Record<string, string> = {
  "Tech Measure": "tech_measure",
  "Install": "install",
  "Service": "service",
  "JIP": "jip",
};

/** Extract the hour from an ISO datetime string. */
function extractHour(isoDatetime: string): number | null {
  const timePart = isoDatetime.split("T")[1];
  if (!timePart) return null;
  const hour = parseInt(timePart.split(":")[0], 10);
  return isNaN(hour) ? null : hour;
}

export function detectFlags(
  appointments: Appointment[],
  crews: Crew[],
  rforceOrders: RForceOrder[],
  timeOffRequests: TimeOffRequest[],
  activeLinks?: AppointmentLink[]
): Flag[] {
  const flags: Flag[] = [];
  const activeAppts = appointments.filter((a) => a.status !== "cancelled");

  for (const appt of activeAppts) {
    const crew = crews.find((c) => c.id === appt.crew_id);
    const crewName = crew?.name || "Unknown";

    const offToday = getTimeOffForDate(timeOffRequests, appt.scheduled_date);
    const isOff = offToday.some((r) => {
      const torFirst = r.employee_name.split(" ")[0].toLowerCase();
      const crewFirst = crewName.split(" ")[0].toLowerCase();
      const torLast = r.employee_name.split(" ").slice(-1)[0].toLowerCase();
      const crewLast = crewName.split(" ").slice(-1)[0].toLowerCase();
      return crewFirst === torFirst && crewLast.slice(0, 4) === torLast.slice(0, 4);
    });
    if (isOff) {
      flags.push({
        id: `pto-${appt.id}`,
        type: "time_off_conflict",
        severity: "error",
        message: `${crewName} is scheduled on ${appt.scheduled_date} but has time off`,
        appointmentId: appt.id,
        crewId: appt.crew_id,
        date: appt.scheduled_date,
      });
    }

    if (appt.time_block) {
      const sameBlock = activeAppts.filter(
        (a) =>
          a.id !== appt.id &&
          a.crew_id === appt.crew_id &&
          a.scheduled_date === appt.scheduled_date &&
          a.time_block === appt.time_block
      );
      if (sameBlock.length > 0 && appt.id < sameBlock[0].id) {
        flags.push({
          id: `dbl-${appt.id}-${sameBlock[0].id}`,
          type: "double_booking",
          severity: "error",
          message: `${crewName} is double-booked on ${appt.scheduled_date} in the ${appt.time_block} block`,
          appointmentId: appt.id,
          crewId: appt.crew_id,
          date: appt.scheduled_date,
        });
      }
    }

    if (!appt.address || appt.address.trim().length < 5) {
      flags.push({
        id: `addr-${appt.id}`,
        type: "missing_address",
        severity: "warning",
        message: `${appt.customer_name} on ${appt.scheduled_date} has no valid address`,
        appointmentId: appt.id,
        date: appt.scheduled_date,
      });
    }

    // --- Unlinked flag ---
    if (activeLinks) {
      const hasLink = activeLinks.some(
        (link) => link.appointment_id === appt.id && !link.unlinked_at
      );
      if (!hasLink) {
        flags.push({
          id: `unlinked-${appt.id}`,
          type: "unlinked",
          severity: "info",
          message: `${appt.customer_name} on ${appt.scheduled_date} has no active rForce link`,
          appointmentId: appt.id,
          date: appt.scheduled_date,
        });
      }
    }
  }

  for (const rf of rforceOrders) {
    if (!rf.scheduled_start) continue;
    const rfDate = rf.scheduled_start.slice(0, 10);
    const linked = activeAppts.find(
      (a) => a.work_order_number === rf.work_order_number
    );
    if (!linked) continue;

    const rfResource = rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
    const linkedCrew = crews.find((c) => c.id === linked.crew_id);
    const linkedCrewName = linkedCrew?.name;

    // --- Date mismatch ---
    const dateMismatch = linked.scheduled_date !== rfDate;

    // --- Crew mismatch (case-insensitive first name) ---
    const crewNameMatch = rfResource && linkedCrewName
      ? linkedCrewName.toLowerCase().split(" ")[0] === rfResource.toLowerCase().split(" ")[0]
      : true;
    const crewMismatch = !crewNameMatch;

    // --- Time mismatch ---
    // Compare actual start_time (HH:MM) against rForce scheduled_start time
    const rforceTime = rf.scheduled_start.slice(11, 16); // "HH:MM"
    const rforceHour = extractHour(rf.scheduled_start);
    const appStartTime = linked.start_time; // "HH:MM"
    const appTimeBlock = linked.time_block;

    // Direct start_time comparison (primary — catches day-view drags)
    const startTimeMismatch = !!(appStartTime && rforceTime && appStartTime !== rforceTime);

    // Time block comparison (fallback for measure techs with block-based scheduling)
    const expectedHour = appTimeBlock ? TIME_BLOCK_HOUR[appTimeBlock] : null;
    const blockMismatch =
      rforceHour !== null && expectedHour !== null && rforceHour !== expectedHour;

    const timeMismatch = startTimeMismatch || blockMismatch;

    // --- Type mismatch ---
    const rfTypeMapped = rf.work_order_type ? WO_TYPE_MAP[rf.work_order_type] : undefined;
    const typeMismatch =
      rfTypeMapped !== undefined && rfTypeMapped !== linked.appointment_type;

    const hasAnyMismatch = dateMismatch || crewMismatch || timeMismatch || typeMismatch;

    if (hasAnyMismatch) {
      const diffs: FlagDifferences = {};
      if (dateMismatch) {
        diffs.date = { app: linked.scheduled_date, rforce: rfDate };
      }
      if (crewMismatch && rfResource) {
        diffs.crew = { app: linkedCrewName || "unassigned", rforce: rfResource };
      }
      if (timeMismatch) {
        diffs.time = { app: appStartTime || appTimeBlock || "none", rforce: rforceTime || `hour ${rforceHour}` };
      }
      if (typeMismatch) {
        diffs.type = { app: linked.appointment_type, rforce: rf.work_order_type || "unknown" };
      }

      if (linked.manual_override) {
        const parts: string[] = [];
        if (dateMismatch) parts.push(`rForce: ${rfDate}`);
        if (crewMismatch && rfResource) parts.push(`rForce crew: ${rfResource}`);
        if (timeMismatch) parts.push(`rForce time: ${rforceTime || `hour ${rforceHour}`}`);
        if (typeMismatch) parts.push(`rForce type: ${rf.work_order_type}`);
        flags.push({
          id: `ovr-${rf.work_order_number}`,
          type: "manual_override",
          severity: "info",
          message: `${rf.customer_name || rf.work_order_number}: manually overridden (${parts.join(", ")})`,
          appointmentId: linked.id,
          date: linked.scheduled_date,
          differences: diffs,
        });
      } else {
        const details: string[] = [];
        if (dateMismatch) details.push(`date: app ${linked.scheduled_date}, rForce ${rfDate}`);
        if (crewMismatch && rfResource) details.push(`crew: app ${linkedCrewName || "unassigned"}, rForce ${rfResource}`);
        if (timeMismatch) details.push(`time: app ${appStartTime || appTimeBlock || "?"}, rForce ${rforceTime || `hour ${rforceHour}`}`);
        if (typeMismatch) details.push(`type: app ${linked.appointment_type}, rForce ${rf.work_order_type}`);
        flags.push({
          id: `disc-${rf.work_order_number}`,
          type: "discrepancy",
          severity: "warning",
          message: `${rf.customer_name || rf.work_order_number}: ${details.join("; ")}`,
          appointmentId: linked.id,
          date: linked.scheduled_date,
          differences: diffs,
        });
      }
    }
  }

  flags.sort((a, b) => {
    const sev = { error: 0, warning: 1, info: 2 };
    return sev[a.severity] - sev[b.severity];
  });

  return flags;
}
