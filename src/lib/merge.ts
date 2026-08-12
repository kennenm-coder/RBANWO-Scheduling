/**
 * Merge rForce data into an existing appointment.
 *
 * Merge rules:
 *   rForce wins: work_order_number, address, customer_name, product_count,
 *                appointment_type, order_number, salesforce_url
 *   Manual wins: crew_id, scheduled_date, time_block, start_time, end_time
 *   Notes:       rForce description appended to existing notes (preserves manual)
 *   Link:        Created with match_method = 'fuzzy'
 *
 * Crash-recovery:
 *   Operations are ordered so the data update (most important) happens first.
 *   Sync fields and link creation are idempotent — safe to retry on partial failure.
 *   The `merge_source_wo` field on the appointment records intent, so a missing
 *   link can be detected and repaired (Phase 16 remediation).
 */

import { Appointment, RForceOrder, AppointmentLink } from "./types";
import {
  updateAppointment,
  updateSyncFields,
  linkAppointment,
  createAppointmentEvent,
} from "./store";
import { buildSalesforceUrl } from "./salesforce";
import { normalizeWoType } from "./normalize";
import { learnResourceMapping } from "./resource-learning";

export interface MergeResult {
  appointment: Appointment;
  link: AppointmentLink | null;
  fieldsUpdated: string[];
  /** Warnings from non-critical operations (link, sync, audit) */
  warnings: string[];
}

/**
 * Build the field-level updates without writing to DB.
 * Pure function — testable without mocks.
 */
export function buildMergeUpdates(
  appointment: Appointment,
  rforceOrder: RForceOrder
): { updates: Partial<Appointment>; fieldsUpdated: string[] } {
  const updates: Partial<Appointment> = {};
  const fieldsUpdated: string[] = [];

  // ── rForce-wins fields ──

  if (
    rforceOrder.work_order_number &&
    rforceOrder.work_order_number !== appointment.work_order_number
  ) {
    updates.work_order_number = rforceOrder.work_order_number;
    fieldsUpdated.push("work_order_number");
  }

  if (
    rforceOrder.order_number &&
    rforceOrder.order_number !== appointment.order_number
  ) {
    updates.order_number = rforceOrder.order_number;
    fieldsUpdated.push("order_number");
  }

  if (rforceOrder.address && rforceOrder.address !== appointment.address) {
    updates.address = rforceOrder.address;
    fieldsUpdated.push("address");
  }

  if (
    rforceOrder.customer_name &&
    rforceOrder.customer_name !== appointment.customer_name
  ) {
    updates.customer_name = rforceOrder.customer_name;
    fieldsUpdated.push("customer_name");
  }

  if (rforceOrder.product_count != null) {
    updates.product_count = rforceOrder.product_count;
    fieldsUpdated.push("product_count");
  }

  const mappedType = normalizeWoType(rforceOrder.work_order_type);
  if (mappedType !== null && mappedType !== appointment.appointment_type) {
    updates.appointment_type = mappedType;
    fieldsUpdated.push("appointment_type");
  }

  if (rforceOrder.work_order_number) {
    updates.salesforce_url = buildSalesforceUrl(rforceOrder.work_order_number);
  }

  updates.merge_source_wo = rforceOrder.work_order_number;

  // ── Notes: append rForce description, preserving existing ──

  if (rforceOrder.description) {
    const existing = appointment.notes || "";
    const rfNote = `[rForce] ${rforceOrder.description}`;
    if (!existing.includes(rfNote)) {
      updates.notes = existing ? `${existing}\n${rfNote}` : rfNote;
      fieldsUpdated.push("notes");
    }
  }

  // ── Scheduler notes from rForce ──
  if (rforceOrder.scheduler_notes) {
    const existing = updates.notes || appointment.notes || "";
    const schedNote = `[rForce notes] ${rforceOrder.scheduler_notes}`;
    if (!existing.includes(schedNote)) {
      updates.notes = existing ? `${existing}\n${schedNote}` : schedNote;
      if (!fieldsUpdated.includes("notes")) fieldsUpdated.push("notes");
    }
  }

  return { updates, fieldsUpdated };
}

export async function mergeRForceIntoAppointment(
  appointment: Appointment,
  rforceOrder: RForceOrder
): Promise<MergeResult> {
  const warnings: string[] = [];
  const { updates, fieldsUpdated } = buildMergeUpdates(appointment, rforceOrder);

  // ── Step 1: Update the appointment (critical — if this fails, throw) ──

  const updated = await updateAppointment(
    appointment.id,
    appointment.version,
    updates
  );
  if (!updated) throw new Error("Failed to update appointment during merge");

  // ── Step 2: Set sync model: origin=merged, sync_state=in_sync ──
  // Non-critical: if this fails, the appointment data is correct but sync
  // state is stale. Detectable by merge_source_wo presence + wrong sync_state.
  try {
    await updateSyncFields(updated.id, {
      origin: "merged",
      sync_state: "in_sync",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[merge] Sync field update failed:", msg);
    warnings.push(`Sync state not updated: ${msg}`);
  }

  // ── Step 3: Create link (idempotent — ALREADY_LINKED is not an error) ──
  // Non-critical: merge data is applied regardless. A missing link can be
  // detected via merge_source_wo on the appointment without a matching link.
  let link: AppointmentLink | null = null;
  try {
    link = await linkAppointment(
      updated.id,
      updated.version,
      rforceOrder,
      "fuzzy"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "ALREADY_LINKED") {
      // Idempotent: appointment already linked to this WO — not an error
      warnings.push("Link already existed (idempotent)");
    } else {
      console.warn("[merge] Link creation failed — merge data applied but no link:", msg);
      warnings.push(`Link not created: ${msg}`);
    }
  }

  // ── Step 4: Audit event (fire-and-forget — never blocks merge) ──
  try {
    await createAppointmentEvent({
      appointment_id: updated.id,
      action: "merged",
      actor_id: null,
      actor_name_snapshot: null,
      before_state: {
        work_order_number: appointment.work_order_number,
        customer_name: appointment.customer_name,
        address: appointment.address,
      },
      after_state: {
        work_order_number: rforceOrder.work_order_number,
        merge_source: "fuzzy_match",
        fields_updated: fieldsUpdated,
      },
      reason: `Merged from rForce order ${rforceOrder.work_order_number}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Audit event not recorded: ${msg}`);
  }

  // ── Step 5: Learn resource mapping (fire-and-forget) ──
  // The appointment's crew_id is the scheduler-confirmed crew for this rForce order.
  if (updated.crew_id) {
    learnResourceMapping(rforceOrder, updated.crew_id);
  }

  return { appointment: updated, link, fieldsUpdated, warnings };
}
