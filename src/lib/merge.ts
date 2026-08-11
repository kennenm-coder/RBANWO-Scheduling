/**
 * Merge rForce data into an existing appointment.
 *
 * Merge rules:
 *   rForce wins: work_order_number, address, customer_name, product_count,
 *                appointment_type, order_number, salesforce_url
 *   Manual wins: crew_id, scheduled_date, time_block, start_time, end_time
 *   Notes:       rForce description appended to existing notes (preserves manual)
 *   Link:        Created with match_method = 'fuzzy'
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

export interface MergeResult {
  appointment: Appointment;
  link: AppointmentLink | null;
  fieldsUpdated: string[];
}

export async function mergeRForceIntoAppointment(
  appointment: Appointment,
  rforceOrder: RForceOrder
): Promise<MergeResult> {
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

  // ── Update the appointment ──

  const updated = await updateAppointment(
    appointment.id,
    appointment.version,
    updates
  );
  if (!updated) throw new Error("Failed to update appointment during merge");

  // ── Set sync model: origin=merged, sync_state=in_sync ──
  try {
    await updateSyncFields(updated.id, {
      origin: "merged",
      sync_state: "in_sync",
    });
  } catch {
    // Sync field update is non-critical — merge data is already applied
  }

  // ── Create link (may fail due to RLS — merge still succeeds) ──

  let link: AppointmentLink | null = null;
  try {
    link = await linkAppointment(
      updated.id,
      updated.version,
      rforceOrder,
      "fuzzy"
    );
  } catch {
    // Link INSERT may fail due to RLS or ALREADY_LINKED — non-fatal
  }

  // ── Audit event ──

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
  } catch {
    // Audit is non-critical
  }

  return { appointment: updated, link, fieldsUpdated };
}
