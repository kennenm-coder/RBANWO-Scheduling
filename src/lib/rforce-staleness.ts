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
 */
export function isOrderStale(order: HasUpdatedAt, latest: number): boolean {
  if (!latest || !order.updated_at) return false;
  const t = Date.parse(order.updated_at);
  if (Number.isNaN(t)) return false;
  return latest - t > STALE_THRESHOLD_MS;
}
