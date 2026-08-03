import {
  Appointment,
  RForceOrder,
  ReconciliationResult,
  ReconciliationStatus,
  ReconciliationDifferences,
  Crew,
  TimeBlock,
} from "./types";
import { buildSalesforceUrl } from "./salesforce";

const CLOSED_WO_STATUSES = new Set([
  "Appt Complete / Closed",
]);

const CANCELLED_WO_STATUSES = new Set([
  "Canceled",
]);

const SCHEDULED_WO_STATUSES = new Set([
  "Scheduled & Assigned",
  "Scheduled",
]);

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

/** Case-insensitive first-name comparison. */
function firstNamesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return true; // if either is missing, treat as non-comparable (match)
  return a.split(" ")[0].toLowerCase() === b.split(" ")[0].toLowerCase();
}

/** Extract the hour from an ISO datetime string (e.g. "2024-06-01T14:00:00" -> 14). */
function extractHour(isoDatetime: string): number | null {
  const timePart = isoDatetime.split("T")[1];
  if (!timePart) return null;
  const hour = parseInt(timePart.split(":")[0], 10);
  return isNaN(hour) ? null : hour;
}

export function reconcile(
  rforceOrders: RForceOrder[],
  appointments: Appointment[],
  crews: Crew[]
): ReconciliationResult[] {
  const crewMap = new Map(crews.map((c) => [c.id, c.name]));
  const apptByWo = new Map<string, Appointment>();
  for (const a of appointments) {
    if (a.work_order_number && a.status !== "cancelled") {
      apptByWo.set(a.work_order_number, a);
    }
  }

  const results: ReconciliationResult[] = [];
  const seen = new Set<string>();

  for (const rf of rforceOrders) {
    seen.add(rf.work_order_number);
    const appt = apptByWo.get(rf.work_order_number);
    const woStatus = rf.wo_status || "";

    let status: ReconciliationStatus;
    let differences: ReconciliationDifferences | undefined;

    if (CLOSED_WO_STATUSES.has(woStatus)) {
      status = "completed";
    } else if (CANCELLED_WO_STATUSES.has(woStatus)) {
      status = "cancelled";
    } else if (appt) {
      if (!rf.scheduled_start) {
        status = "scheduled_app_only";
      } else {
        // --- Date comparison ---
        const rforceDate = rf.scheduled_start.split("T")[0];
        const dateMismatch = rforceDate !== appt.scheduled_date;

        // --- Time comparison ---
        const rforceHour = extractHour(rf.scheduled_start);
        const appTimeBlock = appt.time_block;
        const expectedHour = appTimeBlock ? TIME_BLOCK_HOUR[appTimeBlock] : null;
        const timeMismatch =
          rforceHour !== null && expectedHour !== null && rforceHour !== expectedHour;

        // --- Crew comparison ---
        const rfResource =
          rf.tech_measure_name || rf.installer || rf.service_rep || rf.primary_resource;
        const appCrewName = crewMap.get(appt.crew_id);
        const crewMismatch = !firstNamesMatch(rfResource ?? undefined, appCrewName);

        // --- Type comparison ---
        const rfTypeMapped = rf.work_order_type ? WO_TYPE_MAP[rf.work_order_type] : undefined;
        const typeMismatch =
          rfTypeMapped !== undefined && rfTypeMapped !== appt.appointment_type;

        const hasAnyMismatch = dateMismatch || timeMismatch || crewMismatch || typeMismatch;

        if (hasAnyMismatch) {
          differences = {};
          if (dateMismatch) {
            differences.date = { app: appt.scheduled_date, rforce: rforceDate };
          }
          if (timeMismatch) {
            differences.time = {
              app: appTimeBlock || "none",
              rforce: `hour ${rforceHour}`,
            };
          }
          if (crewMismatch) {
            differences.crew = {
              app: appCrewName || "unassigned",
              rforce: rfResource || "unassigned",
            };
          }
          if (typeMismatch) {
            differences.type = {
              app: appt.appointment_type,
              rforce: rf.work_order_type || "unknown",
            };
          }
        }

        if (!hasAnyMismatch) {
          status = "scheduled_both";
        } else if (appt.manual_override) {
          status = "manual_override";
        } else {
          status = "discrepancy";
        }
      }
    } else if (SCHEDULED_WO_STATUSES.has(woStatus)) {
      status = "scheduled_rforce_only";
    } else {
      status = "unscheduled";
    }

    const assignedTo =
      rf.tech_measure_name || rf.installer || rf.service_rep || rf.primary_resource;

    results.push({
      orderNumber: rf.order_number,
      workOrderNumber: rf.work_order_number,
      status,
      appDate: appt?.scheduled_date,
      rforceDate: rf.scheduled_start?.split("T")[0],
      appCrew: appt ? crewMap.get(appt.crew_id) : undefined,
      rforceCrew: assignedTo || undefined,
      customerName: rf.customer_name || "",
      address: rf.address || "",
      salesforceUrl: buildSalesforceUrl(rf.work_order_number),
      workOrderType: rf.work_order_type || undefined,
      orderStatus: rf.order_status || undefined,
      woStatus: rf.wo_status || undefined,
      productCount: rf.product_count || undefined,
      windows: rf.windows || undefined,
      patioDoors: rf.patio_doors || undefined,
      doors: rf.doors || undefined,
      differences,
    });
  }

  for (const appt of appointments) {
    if (appt.status === "cancelled") continue;
    if (!appt.work_order_number || seen.has(appt.work_order_number)) continue;
    results.push({
      orderNumber: appt.order_number || "",
      workOrderNumber: appt.work_order_number,
      status: "not_in_rforce",
      appDate: appt.scheduled_date,
      appCrew: crewMap.get(appt.crew_id),
      customerName: appt.customer_name,
      address: appt.address,
      salesforceUrl: buildSalesforceUrl(appt.work_order_number),
    });
  }

  return results;
}
