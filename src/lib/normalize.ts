/**
 * Centralized normalization functions for rForce ↔ app value comparison.
 *
 * Every module that needs to compare, map, or normalize rForce values should
 * import from here — not define its own inline map. This ensures:
 *   1. A new WO type alias is added in one place.
 *   2. Time-block tolerance rules are consistent.
 *   3. Status classifications don't drift between flag detection,
 *      reconciliation, queue building, and merge.
 *
 * @see Phase 9 of the rebuild plan (Normalize source values).
 */

import type { AppointmentType, TimeBlock } from "./types";

// ── Work-Order Type Normalization ──

/**
 * Maps raw rForce `work_order_type` strings to canonical AppointmentType keys.
 * Add new aliases here — every consumer picks them up automatically.
 */
const RAW_WO_TYPE_TO_CANONICAL: Record<string, AppointmentType> = {
  "Tech Measure": "tech_measure",
  "Install": "install",
  "Service": "service",
  "JIP": "jip",
  "Job Site Visit": "job_site_visit",
  "Job Site Visit/JIP": "job_site_visit",
  "JSV": "job_site_visit",
  "LSWP": "lswp",
  "HOA": "hoa",
  "Paint/Stain": "paint_stain",
  "Paint": "paint_stain",
  "Paint Shop": "paint_stain",
  "Stain": "paint_stain",
};

/** Case-insensitive lookup map built at module load time. */
const RAW_WO_TYPE_LOWER = new Map<string, AppointmentType>(
  Object.entries(RAW_WO_TYPE_TO_CANONICAL).map(([k, v]) => [k.toLowerCase(), v])
);

/**
 * Normalize a raw rForce work_order_type string to a canonical AppointmentType.
 * Returns `null` for unrecognized or missing values.
 * Lookup order: exact → trimmed → case-insensitive.
 */
export function normalizeWoType(raw: string | null | undefined): AppointmentType | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return (
    RAW_WO_TYPE_TO_CANONICAL[raw] ??
    RAW_WO_TYPE_TO_CANONICAL[trimmed] ??
    RAW_WO_TYPE_LOWER.get(trimmed.toLowerCase()) ??
    null
  );
}

/**
 * Same as normalizeWoType but returns "unknown" instead of null for queue/color use.
 */
export function normalizeWoTypeOrUnknown(raw: string | null | undefined): string {
  return normalizeWoType(raw) ?? "unknown";
}

// ── Time Block ↔ Hour Mapping ──

/**
 * Maps each TimeBlock to the expected rForce scheduled_start hour.
 * Used for comparing app time blocks against rForce ISO datetime hours.
 */
export const TIME_BLOCK_HOUR: Record<TimeBlock, number> = {
  "9-10": 9,
  "10-12": 10,
  "12-2": 12,
  "2-4": 14,
  "4-6": 16,
  full_day: 8,
};

/**
 * Extract the hour from an ISO datetime string (e.g. "2024-06-01T14:30:00" → 14).
 * Returns null if parsing fails.
 */
export function extractHour(isoDatetime: string): number | null {
  const timePart = isoDatetime.split("T")[1];
  if (!timePart) return null;
  const hour = parseInt(timePart.split(":")[0], 10);
  return isNaN(hour) ? null : hour;
}

/**
 * Check whether an rForce scheduled_start hour falls within the tolerance
 * of an app time block. This prevents false time-mismatch flags when, e.g.,
 * rForce says 4:30 PM and the app has the 4-6 block.
 *
 * Returns true if the times are considered equivalent (no mismatch).
 */
export function timeBlockMatchesHour(
  block: TimeBlock,
  rforceHour: number
): boolean {
  const expected = TIME_BLOCK_HOUR[block];
  if (expected === undefined) return false;

  // Full-day appointments: any hour is acceptable
  if (block === "full_day") return true;

  // For timed blocks, allow the rForce hour to be anywhere within the block's range.
  // e.g., "4-6" block → hours 16 and 17 are both valid (16:00–17:59)
  const blockRanges: Record<TimeBlock, [number, number]> = {
    "9-10": [9, 9],
    "10-12": [10, 11],
    "12-2": [12, 13],
    "2-4": [14, 15],
    "4-6": [16, 17],
    full_day: [8, 16],
  };

  const [lo, hi] = blockRanges[block];
  return rforceHour >= lo && rforceHour <= hi;
}

// ── Status Classification ──

/** rForce statuses indicating the work order has been cancelled. */
export const CANCELLED_STATUSES = new Set(["Canceled", "Cancelled"]);

/** rForce statuses indicating the work order is completed/closed. */
export const COMPLETED_STATUSES = new Set(["Appt Complete / Closed"]);

/** rForce statuses indicating the work order is actively scheduled. */
export const SCHEDULED_STATUSES = new Set(["Scheduled & Assigned", "Scheduled"]);

/**
 * rForce order_status values that indicate the order is not currently schedulable.
 * These items add noise to the queue — they can't be acted on until the hold is
 * lifted or the collection/dispute is resolved.
 */
export const NOT_SCHEDULABLE_ORDER_STATUSES = new Set([
  "On Hold",
  "Collection",
  "Collections",
  "Dispute",
  "Credit Hold",
]);

/**
 * Check if an rForce order is cancelled (checks both wo_status and order_status).
 */
export function isRForceCancelled(order: {
  wo_status?: string | null;
  order_status?: string | null;
}): boolean {
  return (
    CANCELLED_STATUSES.has(order.wo_status || "") ||
    CANCELLED_STATUSES.has(order.order_status || "")
  );
}

/**
 * Check if an rForce order's order_status means it's not currently schedulable.
 */
export function isNotSchedulable(order: {
  order_status?: string | null;
}): boolean {
  return NOT_SCHEDULABLE_ORDER_STATUSES.has(order.order_status || "");
}

/**
 * Work-order types that are handled outside the field scheduling workflow.
 * Paint/Stain orders go to the paint shop — they clutter the queue because
 * schedulers can't assign a crew or date to them.
 */
export const NON_FIELD_WO_TYPES: Set<AppointmentType> = new Set([
  "paint_stain",
]);

/**
 * Check if an rForce order's work_order_type is a non-field type
 * (e.g. Paint Shop) that shouldn't appear in the scheduling queue.
 */
export function isNonFieldWork(order: {
  work_order_type?: string | null;
}): boolean {
  const canonical = normalizeWoType(order.work_order_type);
  return canonical !== null && NON_FIELD_WO_TYPES.has(canonical);
}

// ── Resource/Crew Name Comparison ──

/**
 * Case-insensitive first-name comparison.
 * Returns true if either name is missing (non-comparable = no mismatch).
 */
export function firstNamesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return true;
  return a.split(" ")[0].toLowerCase() === b.split(" ")[0].toLowerCase();
}

/**
 * Role columns rForce fills per work-order type. Used ONLY as a fallback when
 * the generic `primary_resource` column is blank — and only for the column that
 * matches the job's own type. This prevents an install from being attributed to
 * the measure tech (or vice versa) just because rForce hasn't populated the
 * Primary Resource field yet: an install scheduled in the app carries a blank
 * Primary Resource until rForce catches up, and its work order still holds the
 * earlier measure tech in `tech_measure_name`.
 */
function typeMatchedResource(order: {
  work_order_type?: string | null;
  tech_measure_name?: string | null;
  installer?: string | null;
  service_rep?: string | null;
}): string | null {
  switch (normalizeWoType(order.work_order_type)) {
    case "tech_measure":
      return order.tech_measure_name || null;
    case "install":
    case "lswp":
    case "hoa":
    case "paint_stain":
      return order.installer || null;
    case "service":
    case "jip":
    case "job_site_visit":
      return order.service_rep || null;
    default:
      // Unknown / unrecognized type — only the explicit Primary Resource is
      // trustworthy; never guess across roles.
      return null;
  }
}

/**
 * Pick the assigned resource name from an rForce order.
 *
 * `primary_resource` — rForce's generic "assigned resource" column — is
 * authoritative. When it's blank (e.g. a job scheduled in the app that rForce
 * hasn't caught up to yet) we fall back ONLY to the role column matching the
 * work-order type, never across roles. A blank result means "rForce hasn't
 * assigned this yet", which callers treat as non-comparable (no mismatch) —
 * NOT as an assignment to whoever happens to sit in another role's column.
 */
export function getRForceResource(order: {
  work_order_type?: string | null;
  primary_resource?: string | null;
  tech_measure_name?: string | null;
  installer?: string | null;
  service_rep?: string | null;
}): string | null {
  return order.primary_resource || typeMatchedResource(order) || null;
}
