/**
 * Simplified issue detection — exactly two issue types:
 *
 *   1. missing  — rForce WO is scheduled but has no non-cancelled calendar tile
 *   2. mismatch — rForce record and linked calendar tile disagree on date/time
 *
 * Everything else (approval states, merge suggestions, dismissals, fuzzy
 * reconciliation) is intentionally excluded from this view.
 */

import type {
  Appointment,
  AppointmentLink,
  Crew,
  ResourceMapping,
  RForceOrder,
} from "./types";
import {
  deriveRForceCalendarStatus,
  type RForceMismatchDetails,
} from "./rforce-calendar-status";
import { isNotSchedulable, isNonFieldWork } from "./normalize";

export type IssueType = "missing" | "mismatch";

export interface SchedulingIssue {
  type: IssueType;
  rforceOrder: RForceOrder;
  appointment?: Appointment;
  mismatchDetails?: RForceMismatchDetails;
  woNumber: string;
  customerName: string;
  address: string;
  rforceDate: string;
  rforceTime?: string;
  appDate?: string;
  appTime?: string;
}

/**
 * Derive the complete list of scheduling issues from rForce and app data.
 * Returns issues sorted: missing first, then mismatches.
 */
export function deriveIssues(
  rforceOrders: RForceOrder[],
  appointments: Appointment[],
  activeLinks: AppointmentLink[],
  crews: Crew[],
  mappings: ResourceMapping[]
): SchedulingIssue[] {
  const items = deriveRForceCalendarStatus(
    rforceOrders,
    appointments,
    activeLinks,
    crews,
    mappings
  );

  const issues: SchedulingIssue[] = [];

  for (const item of items) {
    const rf = item.rforceOrder;

    // Skip non-schedulable / non-field orders (same filter as queue)
    if (isNotSchedulable(rf) || isNonFieldWork(rf)) continue;

    if (item.status === "needs_confirmation") {
      // Missing: rForce says scheduled, no local tile
      if (!rf.scheduled_start) continue; // safety — no date means nothing to show
      issues.push({
        type: "missing",
        rforceOrder: rf,
        woNumber: rf.work_order_number,
        customerName: rf.customer_name || "Unknown",
        address: rf.address || "",
        rforceDate: rf.scheduled_start.slice(0, 10),
        rforceTime: rf.scheduled_start.slice(11, 16) || undefined,
      });
    } else if (item.status === "mismatch") {
      const appt = item.linkedAppointment;
      issues.push({
        type: "mismatch",
        rforceOrder: rf,
        appointment: appt,
        mismatchDetails: item.mismatchDetails,
        woNumber: rf.work_order_number,
        customerName: rf.customer_name || "Unknown",
        address: rf.address || "",
        rforceDate: rf.scheduled_start?.slice(0, 10) || "",
        rforceTime: rf.scheduled_start?.slice(11, 16) || undefined,
        appDate: appt?.scheduled_date || undefined,
        appTime: appt?.start_time?.slice(0, 5) || undefined,
      });
    }
    // synced / reference → not issues
  }

  // Sort: missing first, then mismatches
  issues.sort((a, b) => {
    if (a.type !== b.type) return a.type === "missing" ? -1 : 1;
    return 0;
  });

  return issues;
}
