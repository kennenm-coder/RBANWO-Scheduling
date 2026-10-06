/**
 * Simplified issue detection — three issue types:
 *
 *   1. cancelled_locally — the tile was cancelled here, rForce still has the job
 *                          live. Split out of "missing" because the fix is to
 *                          cancel it in rForce, not to go schedule it.
 *   2. missing  — rForce WO is scheduled but has no calendar tile at all
 *   3. mismatch — rForce record and linked calendar tile disagree on date/time
 *
 * Plus two tile-side reviews that live alongside them on the Issues tab:
 *   • dropped  — a tile whose rForce order stopped appearing in imports
 *   • awaiting — a tile booked in the app that rForce doesn't reflect yet
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
import type { CancelledTile } from "./store";
import {
  deriveRForceCalendarStatus,
  deriveAppointmentRForceState,
  type RForceMismatchDetails,
  type AwaitingRForceReason,
} from "./rforce-calendar-status";
import {
  getRForceResource,
  isNotSchedulable,
  isNonFieldWork,
  COMPLETED_STATUSES,
  CANCELLED_STATUSES,
} from "./normalize";
import { matchCrewByName, timeToBlock } from "./crew-match";
import {
  missedExportCount,
  MISSED_EXPORTS_FOR_RED,
  type AwaitingTier,
} from "./rforce-staleness";

export type IssueType = "missing" | "mismatch" | "cancelled_locally";

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
  /**
   * Only set on "cancelled_locally" issues: the cancelled tile behind the flag,
   * so the UI can jump straight to it and offer to restore it.
   */
  cancelledTile?: CancelledTile;
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
  dismissals: RForceDismissal[] = [],
  /**
   * Tiles cancelled in the app (from fetchCancelledTiles). These are absent from
   * `appointments` by design, so without them a job cancelled here while rForce
   * still shows it live is indistinguishable from one that was never scheduled.
   */
  cancelledTiles: CancelledTile[] = []
): SchedulingIssue[] {
  const normalizeWo = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase();

  // Keyed exactly like the calendar overlay: `${work_order_number}|${date}`.
  const dismissedKeys = new Set(
    dismissals.map((d) => `${d.work_order_number}|${d.rforce_date}`)
  );

  // Most recently cancelled tile per WO — a job cancelled, restored and cancelled
  // again should surface the latest cancellation, not the first.
  const cancelledByWo = new Map<string, CancelledTile>();
  for (const tile of cancelledTiles) {
    const key = normalizeWo(tile.work_order_number);
    if (!key) continue;
    const existing = cancelledByWo.get(key);
    if (!existing || (tile.cancelled_at || "") > (existing.cancelled_at || "")) {
      cancelledByWo.set(key, tile);
    }
  }

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

      // Someone cancelled the tile here while rForce still has the job live.
      // Reported separately from "missing": the action is to cancel it in rForce
      // (or restore the tile), not to go place a job that was never scheduled.
      const cancelled = cancelledByWo.get(normalizeWo(rf.work_order_number));
      if (cancelled) {
        issues.push({
          type: "cancelled_locally",
          rforceOrder: rf,
          woNumber: rf.work_order_number,
          customerName: rf.customer_name || "Unknown",
          address: rf.address || "",
          rforceDate: rf.scheduled_start.slice(0, 10),
          rforceTime: rf.scheduled_start.slice(11, 16) || undefined,
          appDate: cancelled.scheduled_date || undefined,
          cancelledTile: cancelled,
        });
        continue;
      }

      // Already placed on the calendar, just outside the loaded date window
      // (its tile is older/further out than the calendar loads). It isn't
      // missing — approving it would only hit the DUPLICATE_WO guard — so skip.
      if (scheduledWorkOrders.has(normalizeWo(rf.work_order_number))) continue;

      // Resolve where this job would land if approved (same placement logic the
      // approval overlay uses). Only present when the resource maps to a crew.
      let placement: ApprovalPlacement | undefined;
      const resourceName =
        getRForceResource(rf);
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

  // Sort: cancelled-here first (rForce still thinks these are happening, so they
  // are the most urgent to reconcile), then missing, then mismatches.
  const rank: Record<IssueType, number> = {
    cancelled_locally: 0,
    missing: 1,
    mismatch: 2,
  };
  issues.sort((a, b) => rank[a.type] - rank[b.type]);

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
  /** How many daily exports the order has missed (≥ MISSED_EXPORTS_FOR_RED). */
  missedExports: number;
}

/**
 * Detect active calendar tiles whose linked rForce order has stopped appearing in
 * the daily full export — the 🔴 "likely cancel" tier: the order has missed at
 * least MISSED_EXPORTS_FOR_RED (2) daily exports. (The 🟡 "possible cancel" tier —
 * one missed export — shows only as an amber tag on the overlay tile, not here.)
 *
 * Miss counting is by export *event*, using the observed export dates from
 * `sched_import_runs`; a day the export failed to run simply isn't in the list, so
 * it never counts as a miss. See src/lib/rforce-staleness.ts and
 * docs/phase2-dropped-from-rforce.md.
 *
 * Deliberately excluded:
 *  - Orders explicitly cancelled/completed in rForce — handled by the Issue Center's
 *    rforce_cancellation_mismatch flow, not a *silent* drop.
 *  - Orders that haven't missed enough exports yet.
 *  - Tiles the scheduler already dismissed/kept (WO + date in `dismissals`).
 *  - Completed/record-keeping tiles: an appointment marked `complete` stays for
 *    history and is never a cancellation candidate.
 *  - Past-dated tiles: a job whose date has passed naturally stops importing once
 *    it's completed, so a drop there is just history, not a cancellation to review.
 *    Only upcoming (today-onward) tiles are actionable.
 */
export function deriveDroppedTiles(
  appointments: Appointment[],
  rforceOrders: RForceOrder[],
  dismissals: RForceDismissal[] = [],
  exportDates: string[] = [],
  todayISO: string = new Date().toISOString().slice(0, 10)
): DroppedTileIssue[] {
  const normalizeWo = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase();

  if (exportDates.length === 0) return []; // no export history yet → can't count misses

  const orderByWo = new Map<string, RForceOrder>();
  for (const rf of rforceOrders) {
    orderByWo.set(normalizeWo(rf.work_order_number), rf);
  }

  const dismissedKeys = new Set(
    dismissals.map((d) => `${d.work_order_number}|${d.rforce_date}`)
  );

  const dropped: DroppedTileIssue[] = [];

  for (const appt of appointments) {
    // Active, scheduled, linked tiles only. `complete` tiles stay for record
    // keeping and are never cancellation candidates (belt-and-suspenders: they're
    // also past-dated, so the date guard below would catch them too).
    if (
      appt.status === "cancelled" ||
      appt.status === "unscheduled" ||
      appt.status === "complete"
    )
      continue;
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

    // 🔴 red tier only: must have missed at least MISSED_EXPORTS_FOR_RED exports.
    const missed = missedExportCount(rf, exportDates);
    if (missed < MISSED_EXPORTS_FOR_RED) continue; // still present, or only amber

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
      missedExports: missed,
    });
  }

  return dropped;
}

/**
 * A calendar tile booked in the app that rForce doesn't reflect yet — the
 * mirror image of a dropped tile. Normal right after booking (the scheduler
 * simply hasn't entered it in rForce); a real problem once a daily export has
 * run since and rForce still doesn't have it.
 */
export interface AwaitingRForceIssue {
  appointment: Appointment;
  /** Present when the WO exists in rForce but is still on an earlier phase. */
  rforceOrder?: RForceOrder;
  woNumber: string;
  customerName: string;
  address: string;
  scheduledDate: string;
  /** not_in_rforce: no row for the WO. phase_not_scheduled: row is on another phase. */
  reason: AwaitingRForceReason;
  /** pending: no export since booking. overdue: 1+ exports and still missing. */
  tier: AwaitingTier;
  /** Daily exports observed since the app last wrote this appointment. */
  missedExports: number;
}

/**
 * Detect upcoming tiles that carry a work order number but aren't reflected in
 * rForce for their phase. See `deriveAppointmentRForceState` for the rules.
 *
 * Unlike `deriveDroppedTiles`, an empty export history does NOT bail out: with
 * nothing to count against, every hit is simply "pending" (never "overdue").
 *
 * Skips tiles the scheduler dismissed (WO + app date — the same key "Keep
 * tile" writes), so a "won't be entered in rForce" job stops reappearing.
 */
export function deriveAwaitingRForce(
  appointments: Appointment[],
  rforceOrders: RForceOrder[],
  dismissals: RForceDismissal[] = [],
  exportDates: string[] = [],
  todayISO: string = new Date().toISOString().slice(0, 10)
): AwaitingRForceIssue[] {
  const normalizeWo = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase();

  const rfByWo = new Map<string, RForceOrder>();
  for (const rf of rforceOrders) {
    rfByWo.set(normalizeWo(rf.work_order_number), rf);
  }

  const dismissedKeys = new Set(
    dismissals.map((d) => `${d.work_order_number}|${d.rforce_date}`)
  );

  const awaiting: AwaitingRForceIssue[] = [];

  for (const appt of appointments) {
    const state = deriveAppointmentRForceState(appt, rfByWo, exportDates, todayISO);
    if (!state) continue;

    // Prefer rForce's canonical WO spelling so the dismissal key matches what
    // the Issues page writes; fall back to the tile's own when rForce has none.
    const woNumber = state.rforceOrder?.work_order_number || appt.work_order_number!;
    if (dismissedKeys.has(`${woNumber}|${appt.scheduled_date}`)) continue;

    awaiting.push({
      appointment: appt,
      rforceOrder: state.rforceOrder,
      woNumber,
      customerName: appt.customer_name || state.rforceOrder?.customer_name || "Unknown",
      address: appt.address || state.rforceOrder?.address || "",
      scheduledDate: appt.scheduled_date!,
      reason: state.reason,
      tier: state.tier,
      missedExports: state.missedExports,
    });
  }

  // Overdue first (they're the actionable ones), then by date.
  awaiting.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "overdue" ? -1 : 1;
    return a.scheduledDate.localeCompare(b.scheduledDate);
  });

  return awaiting;
}
