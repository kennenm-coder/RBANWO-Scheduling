import {
  Appointment,
  RForceOrder,
  ReconciliationResult,
  ReconciliationStatus,
  Crew,
} from "./types";
import { buildSalesforceUrl } from "./salesforce";

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

  const rforceByWo = new Map<string, RForceOrder>();
  for (const r of rforceOrders) {
    rforceByWo.set(r.work_order_number, r);
  }

  const results: ReconciliationResult[] = [];
  const seen = new Set<string>();

  for (const rf of rforceOrders) {
    seen.add(rf.work_order_number);
    const appt = apptByWo.get(rf.work_order_number);

    let status: ReconciliationStatus;
    if (!appt) {
      status = "unscheduled";
    } else if (!rf.scheduled_start) {
      status = "scheduled_app_only";
    } else {
      const rforceDate = rf.scheduled_start.split("T")[0];
      const appDate = appt.scheduled_date;
      status = rforceDate === appDate ? "scheduled_both" : "discrepancy";
    }

    results.push({
      orderNumber: rf.order_number,
      workOrderNumber: rf.work_order_number,
      status,
      appDate: appt?.scheduled_date,
      rforceDate: rf.scheduled_start?.split("T")[0],
      appCrew: appt ? crewMap.get(appt.crew_id) : undefined,
      rforceCrew: rf.installer || undefined,
      customerName: rf.customer_name || "",
      address: rf.address || "",
      salesforceUrl: buildSalesforceUrl(rf.work_order_number),
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
