/**
 * Resource mapping auto-learning.
 *
 * When a scheduler approves an rForce order or confirms a merge, we learn
 * the rForce resource name → crew ID mapping so future fuzzy matches are
 * more accurate. This is fire-and-forget: a failure to learn never blocks
 * the user action.
 */

import { upsertResourceMapping } from "./store";
import { getRForceResource } from "./normalize";
import type { RForceOrder } from "./types";

/**
 * Learn the resource → crew mapping from an rForce order + crew assignment.
 * No-op if the rForce order has no resource name.
 * Idempotent: re-learning the same pair is a harmless upsert.
 */
export async function learnResourceMapping(
  rforceOrder: RForceOrder,
  crewId: string
): Promise<void> {
  const resourceName = getRForceResource(rforceOrder);
  if (!resourceName || !crewId) return;

  try {
    await upsertResourceMapping(resourceName, crewId);
  } catch (err) {
    // Fire-and-forget — never block the caller
    console.warn(
      "[resource-learning] Failed to learn mapping:",
      resourceName, "→", crewId,
      err instanceof Error ? err.message : err
    );
  }
}
