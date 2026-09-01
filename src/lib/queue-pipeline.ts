/**
 * Focused scheduler queue.
 *
 * rForce contributes reference work only. The queue exposes scheduled orders
 * needing confirmation, linked scheduling mismatches, ordinary unscheduled
 * rForce work, and local appointments explicitly returned to the queue.
 */

import type {
  Appointment,
  AppointmentLink,
  Crew,
  MatchRejection,
  QueueItem,
  QueueItemCategory,
  RForceDismissal,
  RForceOrder,
  ResourceMapping,
} from "./types";
import { normalizeWoTypeOrUnknown, isNotSchedulable, isNonFieldWork, getRForceResource } from "./normalize";
import { typeLabel } from "./calendar-utils";
import { deriveRForceCalendarStatus } from "./rforce-calendar-status";

function parseAddressParts(address: string): { city: string; state: string; zip: string } {
  if (!address) return { city: "", state: "", zip: "" };
  const zipMatches = [...address.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)];
  const zip = zipMatches.at(-1)?.[1] || "";
  const state = address.match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] || "";
  const parts = address.split(",").map((part) => part.trim());
  const city = parts.length >= 3 ? parts[parts.length - 2] : parts.length === 2 ? parts[0] : "";
  return { city, state, zip };
}

function enrichItem(
  base: Omit<QueueItem, "normalizedWoType" | "sourceWoType" | "city" | "state" | "zip" | "hasAlerts" | "hasSchedulerNotes" | "hasPossibleMerge" | "hasMissingInfo">,
  rf?: RForceOrder,
  appt?: Appointment
): QueueItem {
  const sourceWoType = rf?.work_order_type || (appt ? typeLabel(appt.appointment_type) : "");
  const addressParts = parseAddressParts(base.address || "");
  return {
    ...base,
    normalizedWoType: rf
      ? normalizeWoTypeOrUnknown(rf.work_order_type)
      : appt?.appointment_type || "unknown",
    sourceWoType,
    effectiveDate: rf?.scheduled_start?.slice(0, 10) || appt?.scheduled_date || undefined,
    assignedResource: rf ? getRForceResource(rf) ?? undefined : undefined,
    ...addressParts,
    orderStatus: rf?.order_status || undefined,
    woStatus: rf?.wo_status || undefined,
    appointmentStatus: appt?.status || undefined,
    windows: rf?.windows || undefined,
    patioDoors: rf?.patio_doors || undefined,
    doors: rf?.doors || undefined,
    hasAlerts: !!rf?.order_alerts,
    hasSchedulerNotes: !!rf?.scheduler_notes,
    hasPossibleMerge: false,
    hasMissingInfo: !base.customerName || !base.address,
    schedulerNotes: rf?.scheduler_notes || undefined,
  };
}

export function buildQueueItems(
  rforceOrders: RForceOrder[],
  scheduledAppointments: Appointment[],
  unscheduledAppointments: Appointment[],
  crews: Crew[],
  activeLinks: AppointmentLink[],
  dismissals: RForceDismissal[],
  mappings: ResourceMapping[],
  _matchRejections: MatchRejection[] = [],
  /**
   * Work-order numbers (normalized) that already have a tile ANYWHERE on the
   * calendar — including tiles outside the loaded date window (e.g. completed
   * jobs backfilled to history). Such orders are already handled and must not be
   * re-listed as "needs confirmation" just because their tile isn't in the
   * window the calendar currently loads. Mirrors deriveIssues' same guard.
   */
  scheduledWorkOrders: Set<string> = new Set()
): QueueItem[] {
  const items: QueueItem[] = [];
  const dismissalKeys = new Set(
    dismissals.map((dismissal) =>
      `${dismissal.work_order_number.trim().toLowerCase()}|${dismissal.rforce_date}`
    )
  );

  for (const calendarItem of deriveRForceCalendarStatus(
    rforceOrders,
    scheduledAppointments,
    activeLinks,
    crews,
    mappings
  )) {
    const rf = calendarItem.rforceOrder;
    if (isNotSchedulable(rf) || isNonFieldWork(rf) || calendarItem.status === "synced") continue;
    const scheduledDate = rf.scheduled_start?.slice(0, 10);
    if (
      scheduledDate &&
      dismissalKeys.has(`${rf.work_order_number.trim().toLowerCase()}|${scheduledDate}`)
    ) continue;

    // Already placed on the calendar somewhere (incl. outside the loaded window) —
    // approving would only hit the duplicate guard, so it isn't a queue item.
    if (
      calendarItem.status === "needs_confirmation" &&
      scheduledWorkOrders.has(rf.work_order_number.trim().toLowerCase())
    ) continue;

    const category: QueueItemCategory =
      calendarItem.status === "needs_confirmation"
        ? "needs_confirmation"
        : calendarItem.status === "mismatch"
          ? "discrepancy"
          : "unscheduled";
    items.push(enrichItem({
      id: rf.work_order_number,
      category,
      rforceOrder: rf,
      appointment: calendarItem.linkedAppointment,
      customerName: rf.customer_name || "Unknown",
      address: rf.address || "",
      workOrderNumber: rf.work_order_number,
      orderNumber: rf.order_number || undefined,
      workOrderType: rf.work_order_type || undefined,
      productCount: rf.product_count || undefined,
    }, rf, calendarItem.linkedAppointment));
  }

  for (const appt of unscheduledAppointments) {
    const normalizedWo = appt.work_order_number?.trim().toLowerCase();
    const rf = normalizedWo
      ? rforceOrders.find((order) => order.work_order_number.trim().toLowerCase() === normalizedWo)
      : undefined;
    items.push(enrichItem({
      id: appt.id,
      category: "app_unscheduled",
      appointment: appt,
      customerName: appt.customer_name,
      address: appt.address,
      workOrderNumber: appt.work_order_number || undefined,
      orderNumber: appt.order_number || undefined,
      productCount: appt.product_count || undefined,
    }, rf, appt));
  }

  const order: Partial<Record<QueueItemCategory, number>> = {
    needs_confirmation: 0,
    discrepancy: 1,
    app_unscheduled: 2,
    unscheduled: 3,
  };
  return items.sort((a, b) => (order[a.category] ?? 99) - (order[b.category] ?? 99));
}
