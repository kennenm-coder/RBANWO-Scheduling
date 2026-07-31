import {
  Appointment,
  RForceOrder,
  ReconciliationResult,
  ReconciliationStatus,
  Crew,
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

    if (CLOSED_WO_STATUSES.has(woStatus)) {
      status = "completed";
    } else if (CANCELLED_WO_STATUSES.has(woStatus)) {
      status = "cancelled";
    } else if (appt) {
      if (!rf.scheduled_start) {
        status = "scheduled_app_only";
      } else {
        const rforceDate = rf.scheduled_start.split("T")[0];
        if (rforceDate === appt.scheduled_date) {
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
