import {
  Appointment,
  RForceOrder,
  ReconciliationResult,
  ReconciliationStatus,
  ReconciliationDifferences,
  Crew,
} from "./types";
import { buildSalesforceUrl } from "./salesforce";
import {
  COMPLETED_STATUSES,
  CANCELLED_STATUSES,
  SCHEDULED_STATUSES,
  normalizeWoType,
  extractHour,
  firstNamesMatch,
  getRForceResource,
  timeBlockMatchesHour,
} from "./normalize";

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

    if (COMPLETED_STATUSES.has(woStatus)) {
      status = "completed";
    } else if (CANCELLED_STATUSES.has(woStatus)) {
      status = "cancelled";
    } else if (appt) {
      if (!rf.scheduled_start) {
        status = "scheduled_app_only";
      } else {
        // --- Date comparison ---
        const rforceDate = rf.scheduled_start.split("T")[0];
        const dateMismatch = rforceDate !== appt.scheduled_date;

        // --- Time comparison (block-range tolerance) ---
        const rforceHour = extractHour(rf.scheduled_start);
        const appTimeBlock = appt.time_block;
        const timeMismatch = rforceHour !== null && appTimeBlock
          ? !timeBlockMatchesHour(appTimeBlock, rforceHour)
          : false;

        // --- Crew comparison ---
        const rfResource = getRForceResource(rf);
        const appCrewName = appt.crew_id ? crewMap.get(appt.crew_id) : undefined;
        const crewMismatch = !firstNamesMatch(rfResource ?? undefined, appCrewName);

        // --- Type comparison (full normalizer) ---
        const rfTypeMapped = normalizeWoType(rf.work_order_type);
        const typeMismatch = rfTypeMapped !== null && rfTypeMapped !== appt.appointment_type;

        const hasAnyMismatch = dateMismatch || timeMismatch || crewMismatch || typeMismatch;

        if (hasAnyMismatch) {
          differences = {};
          if (dateMismatch) {
            differences.date = { app: appt.scheduled_date || "unscheduled", rforce: rforceDate };
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
    } else if (SCHEDULED_STATUSES.has(woStatus)) {
      status = "scheduled_rforce_only";
    } else {
      status = "unscheduled";
    }

    const assignedTo = getRForceResource(rf);

    results.push({
      orderNumber: rf.order_number,
      workOrderNumber: rf.work_order_number,
      status,
      appDate: appt?.scheduled_date || undefined,
      rforceDate: rf.scheduled_start?.split("T")[0],
      appCrew: appt?.crew_id ? crewMap.get(appt.crew_id) : undefined,
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
    if (appt.status === "cancelled" || appt.status === "unscheduled") continue;
    if (!appt.work_order_number || seen.has(appt.work_order_number)) continue;
    results.push({
      orderNumber: appt.order_number || "",
      workOrderNumber: appt.work_order_number,
      status: "not_in_rforce",
      appDate: appt.scheduled_date || undefined,
      appCrew: appt.crew_id ? crewMap.get(appt.crew_id) : undefined,
      customerName: appt.customer_name,
      address: appt.address,
      salesforceUrl: buildSalesforceUrl(appt.work_order_number),
    });
  }

  return results;
}
