/**
 * Queue pipeline: builds the unified queue by combining reconciliation results,
 * fuzzy match suggestions, and unscheduled appointments.
 */

import {
  Appointment,
  RForceOrder,
  Crew,
  ResourceMapping,
  AppointmentLink,
  RForceDismissal,
  QueueItem,
  QueueItemCategory,
} from "./types";
import { findFuzzyMatches } from "./fuzzy-match";
import { reconcile } from "./reconcile";

/**
 * Build the unified queue items list.
 *
 * Produces items in these categories:
 * - needs_confirmation: rForce scheduled, no app appointment, no fuzzy match
 * - merge_suggested:    rForce scheduled, fuzzy match found → user can merge
 * - unscheduled:        rForce not scheduled (no scheduled_start)
 * - app_unscheduled:    App appointment was unscheduled from calendar
 * - discrepancy:        Linked but data mismatch
 * - not_in_rforce:      In app but not in rForce data
 */
export function buildQueueItems(
  rforceOrders: RForceOrder[],
  scheduledAppointments: Appointment[],
  unscheduledAppointments: Appointment[],
  crews: Crew[],
  activeLinks: AppointmentLink[],
  dismissals: RForceDismissal[],
  mappings: ResourceMapping[]
): QueueItem[] {
  const items: QueueItem[] = [];

  const activeLinkedAppointmentIds = new Set(
    activeLinks
      .filter((l) => !l.unlinked_at)
      .map((l) => l.appointment_id)
  );

  // Dismissed WO+date keys
  const dismissalKeys = new Set(
    dismissals.map((d) => `${d.work_order_number}|${d.rforce_date}`)
  );

  // Run existing reconciliation against scheduled appointments only
  const reconResults = reconcile(rforceOrders, scheduledAppointments, crews);

  for (const r of reconResults) {
    const rf = rforceOrders.find(
      (o) => o.work_order_number === r.workOrderNumber
    );

    // Skip dismissed items
    const dismissKey = rf?.scheduled_start
      ? `${r.workOrderNumber}|${rf.scheduled_start.slice(0, 10)}`
      : null;
    if (dismissKey && dismissalKeys.has(dismissKey)) continue;

    switch (r.status) {
      case "scheduled_rforce_only": {
        if (!rf) break;
        // Check for fuzzy match → merge suggested vs needs confirmation
        const matches = findFuzzyMatches(
          rf,
          scheduledAppointments,
          crews,
          mappings,
          activeLinkedAppointmentIds
        );
        if (matches.length > 0) {
          items.push({
            id: r.workOrderNumber,
            category: "merge_suggested",
            rforceOrder: rf,
            fuzzyMatch: matches[0],
            appointment: matches[0].appointment,
            customerName: r.customerName,
            address: r.address,
            workOrderNumber: r.workOrderNumber,
            orderNumber: r.orderNumber,
            workOrderType: r.workOrderType,
            productCount: r.productCount,
          });
        } else {
          items.push({
            id: r.workOrderNumber,
            category: "needs_confirmation",
            rforceOrder: rf,
            customerName: r.customerName,
            address: r.address,
            workOrderNumber: r.workOrderNumber,
            orderNumber: r.orderNumber,
            workOrderType: r.workOrderType,
            productCount: r.productCount,
          });
        }
        break;
      }

      case "unscheduled": {
        items.push({
          id: r.workOrderNumber,
          category: "unscheduled",
          rforceOrder: rf || undefined,
          customerName: r.customerName,
          address: r.address,
          workOrderNumber: r.workOrderNumber,
          orderNumber: r.orderNumber,
          workOrderType: r.workOrderType,
          productCount: r.productCount,
        });
        break;
      }

      case "discrepancy": {
        items.push({
          id: r.workOrderNumber,
          category: "discrepancy",
          rforceOrder: rf || undefined,
          customerName: r.customerName,
          address: r.address,
          workOrderNumber: r.workOrderNumber,
          orderNumber: r.orderNumber,
          workOrderType: r.workOrderType,
          productCount: r.productCount,
        });
        break;
      }

      case "not_in_rforce": {
        items.push({
          id: r.workOrderNumber,
          category: "not_in_rforce",
          customerName: r.customerName,
          address: r.address,
          workOrderNumber: r.workOrderNumber,
          orderNumber: r.orderNumber,
        });
        break;
      }

      // scheduled_both, completed, cancelled, etc. → not shown in queue
    }
  }

  // Flow D: App appointments that were unscheduled from the calendar
  for (const appt of unscheduledAppointments) {
    items.push({
      id: appt.id,
      category: "app_unscheduled",
      appointment: appt,
      customerName: appt.customer_name,
      address: appt.address,
      workOrderNumber: appt.work_order_number || undefined,
      orderNumber: appt.order_number || undefined,
      productCount: appt.product_count || undefined,
    });
  }

  // Sort: merge_suggested first (actionable), then needs_confirmation,
  // then app_unscheduled, then unscheduled, then discrepancy, then not_in_rforce
  const ORDER: Record<QueueItemCategory, number> = {
    merge_suggested: 0,
    needs_confirmation: 1,
    app_unscheduled: 2,
    unscheduled: 3,
    discrepancy: 4,
    not_in_rforce: 5,
  };
  items.sort((a, b) => ORDER[a.category] - ORDER[b.category]);

  return items;
}
