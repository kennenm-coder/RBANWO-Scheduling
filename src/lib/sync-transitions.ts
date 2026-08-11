/**
 * Sync state machine transitions.
 *
 * Centralizes sync_state logic so individual handlers (drag, reschedule,
 * link, unlink, create) don't embed state-machine rules inline.
 *
 * All transitions are non-blocking — a failed sync update never blocks
 * the primary operation, but failures are logged to console.warn so
 * they're observable during development.
 */

import type { Appointment, OriginalEntrySnapshot } from "./types";
import { updateSyncFields, createAppointmentEvent } from "./store";

// ── Snapshot capture ──

/** Build an immutable snapshot of the scheduler's original manual entry. */
export function captureOriginalEntry(appt: {
  customer_name: string;
  address: string;
  scheduled_date: string | null;
  crew_id: string | null;
  time_block: Appointment["time_block"];
  start_time: string | null;
  notes: string | null;
  appointment_type: Appointment["appointment_type"];
}): OriginalEntrySnapshot {
  return {
    customer_name: appt.customer_name,
    address: appt.address,
    scheduled_date: appt.scheduled_date,
    crew_id: appt.crew_id,
    time_block: appt.time_block,
    start_time: appt.start_time,
    notes: appt.notes,
    appointment_type: appt.appointment_type,
    captured_at: new Date().toISOString(),
  };
}

// ── Transition: scheduler changed a linked appointment ──

/**
 * After a drag, reschedule, or manual edit on a linked appointment that
 * was in_sync, move to waiting_for_import so the next reconciliation
 * detects the change.
 */
export async function onSchedulerEditedLinkedAppointment(
  appt: Appointment
): Promise<void> {
  if (appt.sync_state !== "in_sync") return;
  try {
    await updateSyncFields(appt.id, { sync_state: "waiting_for_import" });
    await createAppointmentEvent({
      appointment_id: appt.id,
      action: "sync_state_changed",
      actor_id: null,
      actor_name_snapshot: null,
      before_state: { sync_state: "in_sync" },
      after_state: { sync_state: "waiting_for_import" },
      reason: "Scheduler edited a synced appointment",
    });
  } catch (err) {
    console.warn("[sync] Failed to transition to waiting_for_import:", err instanceof Error ? err.message : err);
  }
}

// ── Transition: linked ──

/** After linking an appointment to an rForce order. */
export async function onAppointmentLinked(
  appointmentId: string,
  previousSyncState: string
): Promise<void> {
  try {
    await updateSyncFields(appointmentId, {
      sync_state: "linked_pending_confirmation",
    });
    await createAppointmentEvent({
      appointment_id: appointmentId,
      action: "sync_state_changed",
      actor_id: null,
      actor_name_snapshot: null,
      before_state: { sync_state: previousSyncState },
      after_state: { sync_state: "linked_pending_confirmation" },
      reason: "Appointment linked to rForce order",
    });
  } catch (err) {
    console.warn("[sync] Failed to transition to linked_pending_confirmation:", err instanceof Error ? err.message : err);
  }
}

// ── Transition: unlinked ──

/** After unlinking an appointment from its rForce order. */
export async function onAppointmentUnlinked(
  appointmentId: string,
  previousSyncState: string
): Promise<void> {
  try {
    await updateSyncFields(appointmentId, {
      sync_state: "manual_awaiting_rforce",
    });
    await createAppointmentEvent({
      appointment_id: appointmentId,
      action: "sync_state_changed",
      actor_id: null,
      actor_name_snapshot: null,
      before_state: { sync_state: previousSyncState },
      after_state: { sync_state: "manual_awaiting_rforce" },
      reason: "Appointment unlinked from rForce order",
    });
  } catch (err) {
    console.warn("[sync] Failed to transition to manual_awaiting_rforce:", err instanceof Error ? err.message : err);
  }
}
