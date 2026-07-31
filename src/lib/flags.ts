import { Appointment, Crew, RForceOrder, TimeOffRequest } from "./types";
import { getTimeOffForDate } from "./store";

export type FlagSeverity = "error" | "warning" | "info";

export interface Flag {
  id: string;
  type: "time_off_conflict" | "double_booking" | "discrepancy" | "missing_address" | "manual" | "manual_override";
  severity: FlagSeverity;
  message: string;
  appointmentId?: string;
  crewId?: string;
  date?: string;
}

export function detectFlags(
  appointments: Appointment[],
  crews: Crew[],
  rforceOrders: RForceOrder[],
  timeOffRequests: TimeOffRequest[]
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
  }

  for (const rf of rforceOrders) {
    if (!rf.scheduled_start) continue;
    const rfDate = rf.scheduled_start.slice(0, 10);
    const linked = activeAppts.find(
      (a) => a.work_order_number === rf.work_order_number
    );
    if (!linked) continue;

    const rfResource = rf.tech_measure_name || rf.installer || rf.service_rep || rf.primary_resource;
    const linkedCrew = crews.find((c) => c.id === linked.crew_id);
    const crewNameMatch = rfResource && linkedCrew
      ? linkedCrew.name.toLowerCase().split(" ")[0] === rfResource.toLowerCase().split(" ")[0]
      : true;

    const dateMismatch = linked.scheduled_date !== rfDate;
    const crewMismatch = !crewNameMatch;

    if (dateMismatch || crewMismatch) {
      if (linked.manual_override) {
        const parts: string[] = [];
        if (dateMismatch) parts.push(`rForce: ${rfDate}`);
        if (crewMismatch && rfResource) parts.push(`rForce crew: ${rfResource}`);
        flags.push({
          id: `ovr-${rf.work_order_number}`,
          type: "manual_override",
          severity: "info",
          message: `${rf.customer_name || rf.work_order_number}: manually overridden (${parts.join(", ")})`,
          appointmentId: linked.id,
          date: linked.scheduled_date,
        });
      } else {
        const details: string[] = [];
        if (dateMismatch) details.push(`app: ${linked.scheduled_date}, rForce: ${rfDate}`);
        if (crewMismatch && rfResource) details.push(`crew mismatch: ${rfResource}`);
        flags.push({
          id: `disc-${rf.work_order_number}`,
          type: "discrepancy",
          severity: "warning",
          message: `${rf.customer_name || rf.work_order_number}: ${details.join("; ")}`,
          appointmentId: linked.id,
          date: linked.scheduled_date,
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
