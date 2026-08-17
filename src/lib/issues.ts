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
  RForceDismissal,
  RForceOrder,
  TimeBlock,
} from "./types";
import {
  deriveRForceCalendarStatus,
  type RForceMismatchDetails,
} from "./rforce-calendar-status";
import {
  isNotSchedulable,
  isNonFieldWork,
  COMPLETED_STATUSES,
  CANCELLED_STATUSES,
} from "./normalize";
import { matchCrewByName, timeToBlock } from "./crew-match";
import { latestImportTime, isOrderStale } from "./rforce-staleness";

export type IssueType = "missing" | "mismatch";

/**
 * For a "missing" issue, where the job would land on the calendar if approved.
 * Present only when the rForce resource maps to a known crew — otherwise the
 * job can't be auto-placed and must be scheduled manually.
 */
export interface ApprovalPlacement {
  crewId: string;
  timeBlock: TimeBlock;
  scheduledDate: string;
}

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
  /** Only set on "missing" issues whose resource maps to a crew (approvable). */
  placement?: ApprovalPlacement;
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
  mappings: ResourceMapping[],
  /**
   * Work-order numbers that already have a placed appointment anywhere on the
   * calendar (from fetchScheduledWorkOrderNumbers) — including tiles outside the
   * loaded date window. A job in this set is already scheduled, so it must not
   * be flagged "missing" just because its tile falls outside the loaded window.
   */
  scheduledWorkOrders: Set<string> = new Set(),
  /**
   * rForce orders the scheduler has explicitly dismissed (e.g. confirmed
   * cancelled after dropping out of imports). A dismissed WO+date is no longer
   * an actionable issue — mirrors the same skip the calendar overlay applies.
   */
  dismissals: RForceDismissal[] = []
): SchedulingIssue[] {
  const normalizeWo = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase();

  // Keyed exactly like the calendar overlay: `${work_order_number}|${date}`.
  const dismissedKeys = new Set(
    dismissals.map((d) => `${d.work_order_number}|${d.rforce_date}`)
  );

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

    // Skip completed/cancelled orders — a closed or cancelled job never needs a
    // calendar tile, so it isn't a "missing" issue. This mirrors the same filter
    // the rForce approval overlay applies in getRForceDisplayItems, keeping the
    // Issues list in sync with what's actually approvable.
    const woS = rf.wo_status || "";
    const ordS = rf.order_status || "";
    if (
      COMPLETED_STATUSES.has(woS) ||
      CANCELLED_STATUSES.has(woS) ||
      CANCELLED_STATUSES.has(ordS)
    ) {
      continue;
    }

    // Explicitly dismissed by the scheduler (cancelled/handled) — drop it so it
    // doesn't keep reappearing in the Issues list after being dismissed.
    if (
      rf.scheduled_start &&
      dismissedKeys.has(`${rf.work_order_number}|${rf.scheduled_start.slice(0, 10)}`)
    ) {
      continue;
    }

    if (item.status === "needs_confirmation") {
      // Missing: rForce says scheduled, no local tile
      if (!rf.scheduled_start) continue; // safety — no date means nothing to show

      // Already placed on the calendar, just outside the loaded date window
      // (its tile is older/further out than the calendar loads). It isn't
      // missing — approving it would only hit the DUPLICATE_WO guard — so skip.
      if (scheduledWorkOrders.has(normalizeWo(rf.work_order_number))) continue;

      // Resolve where this job would land if approved (same placement logic the
      // approval overlay uses). Only present when the resource maps to a crew.
      let placement: ApprovalPlacement | undefined;
      const resourceName =
        rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
      const crew = resourceName ? matchCrewByName(resourceName, crews, mappings) : undefined;
      if (crew) {
        const hour = parseInt(rf.scheduled_start.slice(11, 13), 10);
        const timeBlock: TimeBlock =
          crew.crew_type === "measure_tech" ? timeToBlock(hour) : "full_day";
        placement = {
          crewId: crew.id,
          timeBlock,
          scheduledDate: rf.scheduled_start.slice(0, 10),
        };
      }

      issues.push({
        type: "missing",
        rforceOrder: rf,
        woNumber: rf.work_order_number,
        customerName: rf.customer_name || "Unknown",
        address: rf.address || "",
        rforceDate: rf.scheduled_start.slice(0, 10),
        rforceTime: rf.scheduled_start.slice(11, 16) || undefined,
        placement,
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

/**
 * A scheduled calendar tile whose backing rForce work order has silently dropped
 * out of recent imports — a likely cancellation/reschedule that needs review.
 * Distinct from a "missing" issue (rForce scheduled, no tile): here the tile
 * exists but its source record has gone stale.
 */
export interface DroppedTileIssue {
  appointment: Appointment;
  rforceOrder: RForceOrder;
  woNumber: string;
  customerName: string;
  address: string;
  scheduledDate: string;
  /** Last time this order appeared in an import (its updated_at). */
  lastSeen: string;
}

/**
 * Detect active calendar tiles whose linked rForce order has stopped appearing in
 * imports (heuristic: its updated_at has fallen behind the newest imported order by
 * more than STALE_THRESHOLD_MS). These are candidates for cancellation review.
 *
 * This is the Phase 1 heuristic. Its limitation (can't tell a complete import from a
 * partial one) and the Phase 2 plan for precise consecutive-miss counting are
 * documented in docs/phase2-dropped-from-rforce.md.
 *
 * Deliberately excluded:
 *  - Orders explicitly cancelled/completed in rForce — handled by the Issue Center's
 *    rforce_cancellation_mismatch flow, not a *silent* drop.
 *  - Orders still appearing recently (not stale).
 *  - Tiles the scheduler already dismissed/kept (WO + date in `dismissals`).
 *  - Past-dated tiles: a job whose date has passed naturally stops importing once
 *    it's completed, so a drop there is just history, not a cancellation to review.
 *    Only upcoming (today-onward) tiles are actionable.
 */
export function deriveDroppedTiles(
  appointments: Appointment[],
  rforceOrders: RForceOrder[],
  dismissals: RForceDismissal[] = [],
  todayISO: string = new Date().toISOString().slice(0, 10)
): DroppedTileIssue[] {
  const normalizeWo = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase();

  const newest = latestImportTime(rforceOrders);
  if (!newest) return []; // no imports to compare against → nothing is "dropped"

  const orderByWo = new Map<string, RForceOrder>();
  for (const rf of rforceOrders) {
    orderByWo.set(normalizeWo(rf.work_order_number), rf);
  }

  const dismissedKeys = new Set(
    dismissals.map((d) => `${d.work_order_number}|${d.rforce_date}`)
  );

  const dropped: DroppedTileIssue[] = [];

  for (const appt of appointments) {
    // Active, scheduled, linked tiles only.
    if (appt.status === "cancelled" || appt.status === "unscheduled") continue;
    if (!appt.scheduled_date || !appt.work_order_number) continue;

    // Only upcoming tiles — a past job dropping out is just it being completed.
    if (appt.scheduled_date < todayISO) continue;

    const rf = orderByWo.get(normalizeWo(appt.work_order_number));
    if (!rf) continue; // no backing order → an unlinked issue, not a drop

    // Explicit cancellation/completion is handled elsewhere (Issue Center).
    const woS = rf.wo_status || "";
    const ordS = rf.order_status || "";
    if (
      COMPLETED_STATUSES.has(woS) ||
      CANCELLED_STATUSES.has(woS) ||
      CANCELLED_STATUSES.has(ordS)
    ) {
      continue;
    }

    if (!isOrderStale(rf, newest)) continue; // still appearing → fine

    // Already dismissed or explicitly kept.
    if (dismissedKeys.has(`${rf.work_order_number}|${appt.scheduled_date}`)) continue;

    dropped.push({
      appointment: appt,
      rforceOrder: rf,
      // Canonical rForce WO — matches the dismissal key written by "Keep tile".
      woNumber: rf.work_order_number,
      customerName: appt.customer_name || rf.customer_name || "Unknown",
      address: appt.address || rf.address || "",
      scheduledDate: appt.scheduled_date,
      lastSeen: rf.updated_at,
    });
  }

  return dropped;
}
