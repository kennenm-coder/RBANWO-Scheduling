/**
 * rForce staleness — an imported order that has stopped appearing in recent
 * imports has almost certainly dropped out of rForce (cancelled or rescheduled
 * away). rForce exports don't mark these "Cancelled"; they simply omit them, so
 * our copy freezes at its last-seen state and lingers as a phantom.
 *
 * Each import bulk-upserts the current orders and bumps their `updated_at`, so an
 * order whose `updated_at` falls well behind the newest import wasn't in it. We
 * FLAG (not hide) these so a scheduler can confirm and dismiss — safe even when
 * an import is only a partial slice of the schedule.
 */

/** How far behind the newest import an order may fall before it's "stale". */
export const STALE_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

interface HasUpdatedAt {
  updated_at?: string | null;
}

/** Timestamp (ms) of the most recent import across the given orders. */
export function latestImportTime(orders: HasUpdatedAt[]): number {
  let max = 0;
  for (const o of orders) {
    if (!o.updated_at) continue;
    const t = Date.parse(o.updated_at);
    if (!Number.isNaN(t) && t > max) max = t;
  }
  return max;
}

/**
 * True when the order hasn't been refreshed by an import in a while relative to
 * the newest import — i.e. it appears to have dropped out of rForce.
 *
 * @deprecated Time-based heuristic superseded by the export-count model below
 * (`missedExportCount` / `dropTier`). Kept for the legacy test and any callers
 * not yet migrated.
 */
export function isOrderStale(order: HasUpdatedAt, latest: number): boolean {
  if (!latest || !order.updated_at) return false;
  const t = Date.parse(order.updated_at);
  if (Number.isNaN(t)) return false;
  return latest - t > STALE_THRESHOLD_MS;
}

// ── Two-tier "dropped from rForce" detection (export-count model) ──
//
// Cancellations aren't a status; a cancelled job just stops appearing in the
// daily full export. We escalate by *how many daily exports* an order has missed:
//   • missed 1  → 🟡 "possible cancel"  (early warning; soft tag on the tile)
//   • missed 2+ → 🔴 "likely cancel"    (Issue Center review)
// Counting misses in export *events* (not wall-clock days) makes it robust to a
// day the export fails to run: that day simply never enters the export-date list.

/** Missed daily exports before a tile is tagged 🟡 "possible cancel". */
export const MISSED_EXPORTS_FOR_AMBER = 1;
/** Missed daily exports before a tile is flagged 🔴 "likely cancel". */
export const MISSED_EXPORTS_FOR_RED = 2;
/**
 * Minimum rows sharing one `updated_at` date for it to count as a *full* daily
 * export rather than an incremental hourly sync (which touch only a handful of
 * changed orders). The daily export refreshes hundreds; incrementals < ~20.
 */
export const MIN_FULL_EXPORT_SIZE = 100;

export type DropTier = "present" | "possible_cancel" | "likely_cancel";

/**
 * How many observed daily exports ran *after* this order was last seen. Because
 * each daily export overwrites `updated_at`, an order's `updated_at` date is the
 * last export it appeared in; every known export date newer than that is a miss.
 *
 * @param exportDates observed full-export dates as `YYYY-MM-DD` (any order).
 */
export function missedExportCount(order: HasUpdatedAt, exportDates: string[]): number {
  if (!order.updated_at) return 0;
  const lastSeen = order.updated_at.slice(0, 10);
  let missed = 0;
  for (const d of exportDates) if (d > lastSeen) missed++;
  return missed;
}

/** Escalation tier for an order given the observed daily-export dates. */
export function dropTier(order: HasUpdatedAt, exportDates: string[]): DropTier {
  const missed = missedExportCount(order, exportDates);
  if (missed >= MISSED_EXPORTS_FOR_RED) return "likely_cancel";
  if (missed >= MISSED_EXPORTS_FOR_AMBER) return "possible_cancel";
  return "present";
}

/**
 * The most recent date on which a *full* daily export appears to have run, found
 * as the newest `updated_at` date whose cluster is at least `minClusterSize`.
 * Returns `YYYY-MM-DD`, or null when no cluster is large enough (e.g. the app
 * loaded before today's export ran). The app records this each load so the
 * export-date history accumulates.
 */
export function detectLatestExportDate(
  orders: HasUpdatedAt[],
  minClusterSize: number = MIN_FULL_EXPORT_SIZE
): { date: string; orderCount: number } | null {
  const counts = new Map<string, number>();
  for (const o of orders) {
    if (!o.updated_at) continue;
    const d = o.updated_at.slice(0, 10);
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best: { date: string; orderCount: number } | null = null;
  for (const [date, orderCount] of counts) {
    if (orderCount < minClusterSize) continue;
    if (best === null || date > best.date) best = { date, orderCount };
  }
  return best;
}
