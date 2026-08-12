/**
 * Queue pipeline: builds the unified queue by combining reconciliation results,
 * fuzzy match suggestions, and unscheduled appointments.
 *
 * Every QueueItem carries normalized fields (city, state, zip, normalizedWoType, etc.)
 * so consumers can filter/sort without re-parsing.
 */

import {
  Appointment,
  RForceOrder,
  Crew,
  ResourceMapping,
  AppointmentLink,
  RForceDismissal,
  MatchRejection,
  QueueItem,
  QueueItemCategory,
} from "./types";
import { buildFuzzyMatchIndex, findFuzzyMatchesIndexed } from "./fuzzy-match";
import { reconcile } from "./reconcile";
import { normalizeWoType } from "./wo-type-colors";
import { typeLabel } from "./calendar-utils";

// ── Address parsing ──

function parseAddressParts(address: string): { city: string; state: string; zip: string } {
  if (!address) return { city: "", state: "", zip: "" };

  let zip = "";
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipMatch) zip = zipMatch[1];

  let state = "";
  const stateMatch = address.match(/,\s*([A-Z]{2})\s+\d{5}/);
  if (stateMatch) state = stateMatch[1];

  let city = "";
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 3) {
    // "123 Main St, Toledo, OH 43604" → city is parts[length-2]
    city = parts[parts.length - 2];
  } else if (parts.length === 2) {
    // Could be "Toledo, OH 43604" — city is first part
    city = parts[0];
  }

  return { city, state, zip };
}

function getAssignedResource(rf: RForceOrder): string | undefined {
  return rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep || undefined;
}

function hasMissingInfo(item: Partial<QueueItem>): boolean {
  return (
    !item.customerName ||
    item.customerName === "Unknown" ||
    !item.address ||
    item.productCount == null ||
    item.productCount === 0
  );
}

// ── Build helpers ──

function enrichItem(
  base: Omit<QueueItem, "normalizedWoType" | "sourceWoType" | "city" | "state" | "zip" | "hasAlerts" | "hasSchedulerNotes" | "hasPossibleMerge" | "hasMissingInfo">,
  rf?: RForceOrder,
  appt?: Appointment
): QueueItem {
  const rawType = rf?.work_order_type || (appt ? typeLabel(appt.appointment_type) : undefined);
  const normalizedWoType = rf
    ? normalizeWoType(rf.work_order_type)
    : appt
      ? appt.appointment_type
      : "unknown";

  const addr = parseAddressParts(base.address || "");

  const effectiveDate = rf?.scheduled_start
    ? rf.scheduled_start.slice(0, 10)
    : appt?.scheduled_date || undefined;

  return {
    ...base,
    normalizedWoType,
    sourceWoType: rawType || "",
    effectiveDate,
    assignedResource: rf ? getAssignedResource(rf) : undefined,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    orderStatus: rf?.order_status || undefined,
    woStatus: rf?.wo_status || undefined,
    appointmentStatus: appt?.status || undefined,
    windows: rf?.windows || undefined,
    patioDoors: rf?.patio_doors || undefined,
    doors: rf?.doors || undefined,
    hasAlerts: !!(rf?.order_alerts),
    hasSchedulerNotes: !!(rf?.scheduler_notes),
    hasPossibleMerge: base.category === "merge_suggested",
    hasMissingInfo: hasMissingInfo(base),
    schedulerNotes: rf?.scheduler_notes || undefined,
  };
}

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
  mappings: ResourceMapping[],
  matchRejections: MatchRejection[] = []
): QueueItem[] {
  const items: QueueItem[] = [];

  // Index rForce orders by WO number for O(1) lookup
  const rfByWo = new Map<string, RForceOrder>();
  for (const rf of rforceOrders) {
    rfByWo.set(rf.work_order_number, rf);
  }

  const activeLinkedAppointmentIds = new Set(
    activeLinks
      .filter((l) => !l.unlinked_at)
      .map((l) => l.appointment_id)
  );

  // Dismissed WO+date keys
  const dismissalKeys = new Set(
    dismissals.map((d) => `${d.work_order_number}|${d.rforce_date}`)
  );

  // Rejected match pairs (appointmentId|workOrderNumber)
  const rejectedPairs = new Set(
    matchRejections.map((r) => `${r.appointment_id}|${r.work_order_number}`)
  );

  // Run existing reconciliation against scheduled appointments only
  const reconResults = reconcile(rforceOrders, scheduledAppointments, crews);

  // Build fuzzy match index ONCE, reused for all scheduled_rforce_only results.
  // This pre-computes normalized names/addresses/crew lookups so each match
  // call skips O(M) normalization work — down from O(N×M) to O(N×M') where
  // M' is only the comparison + scoring loop.
  const fuzzyIndex = buildFuzzyMatchIndex(scheduledAppointments, crews, activeLinkedAppointmentIds);

  for (const r of reconResults) {
    const rf = rfByWo.get(r.workOrderNumber);

    // Skip dismissed items
    const dismissKey = rf?.scheduled_start
      ? `${r.workOrderNumber}|${rf.scheduled_start.slice(0, 10)}`
      : null;
    if (dismissKey && dismissalKeys.has(dismissKey)) continue;

    switch (r.status) {
      case "scheduled_rforce_only": {
        if (!rf) break;
        // Check for fuzzy match → merge suggested vs needs confirmation
        const matches = findFuzzyMatchesIndexed(
          rf,
          fuzzyIndex,
          mappings,
          rejectedPairs
        );
        if (matches.length > 0) {
          items.push(
            enrichItem(
              {
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
              },
              rf,
              matches[0].appointment
            )
          );
        } else {
          items.push(
            enrichItem(
              {
                id: r.workOrderNumber,
                category: "needs_confirmation",
                rforceOrder: rf,
                customerName: r.customerName,
                address: r.address,
                workOrderNumber: r.workOrderNumber,
                orderNumber: r.orderNumber,
                workOrderType: r.workOrderType,
                productCount: r.productCount,
              },
              rf
            )
          );
        }
        break;
      }

      case "unscheduled": {
        items.push(
          enrichItem(
            {
              id: r.workOrderNumber,
              category: "unscheduled",
              rforceOrder: rf || undefined,
              customerName: r.customerName,
              address: r.address,
              workOrderNumber: r.workOrderNumber,
              orderNumber: r.orderNumber,
              workOrderType: r.workOrderType,
              productCount: r.productCount,
            },
            rf
          )
        );
        break;
      }

      case "discrepancy": {
        items.push(
          enrichItem(
            {
              id: r.workOrderNumber,
              category: "discrepancy",
              rforceOrder: rf || undefined,
              customerName: r.customerName,
              address: r.address,
              workOrderNumber: r.workOrderNumber,
              orderNumber: r.orderNumber,
              workOrderType: r.workOrderType,
              productCount: r.productCount,
            },
            rf
          )
        );
        break;
      }

      case "not_in_rforce": {
        const appt = scheduledAppointments.find(
          (a) => a.work_order_number === r.workOrderNumber && a.status !== "cancelled"
        );
        items.push(
          enrichItem(
            {
              id: r.workOrderNumber,
              category: "not_in_rforce",
              customerName: r.customerName,
              address: r.address,
              workOrderNumber: r.workOrderNumber,
              orderNumber: r.orderNumber,
            },
            undefined,
            appt
          )
        );
        break;
      }

      // scheduled_both, completed, cancelled, etc. → not shown in queue
    }
  }

  // Flow D: App appointments that were unscheduled from the calendar
  for (const appt of unscheduledAppointments) {
    const rf = appt.work_order_number ? rfByWo.get(appt.work_order_number) : undefined;
    items.push(
      enrichItem(
        {
          id: appt.id,
          category: "app_unscheduled",
          appointment: appt,
          customerName: appt.customer_name,
          address: appt.address,
          workOrderNumber: appt.work_order_number || undefined,
          orderNumber: appt.order_number || undefined,
          productCount: appt.product_count || undefined,
        },
        rf,
        appt
      )
    );
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
