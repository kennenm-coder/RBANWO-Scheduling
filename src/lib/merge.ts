/**
 * Merge rForce data into an existing appointment.
 *
 * Merge rules:
 *   rForce wins: work_order_number, address, customer_name, product_count,
 *                appointment_type, order_number, salesforce_url
 *   Manual wins: crew_id, scheduled_date, time_block, start_time, end_time
 *                (by default - the scheduler can pick rForce's date/time/crew, or
 *                keep their own address/name/type, per field in the confirm modal;
 *                see MergeChoices)
 *   Notes:       rForce description appended to existing notes (preserves manual)
 *   Link:        Created with match_method = 'fuzzy'
 *
 * Crash-recovery:
 *   Operations are ordered so the data update (most important) happens first.
 *   Sync fields and link creation are idempotent — safe to retry on partial failure.
 *   The `merge_source_wo` field on the appointment records intent, so a missing
 *   link can be detected and repaired (Phase 16 remediation).
 */

import { Appointment, RForceOrder, AppointmentLink, Crew, ResourceMapping } from "./types";
import {
  updateAppointment,
  updateSyncFields,
  linkAppointment,
  createAppointmentEvent,
} from "./store";
import { buildSalesforceUrl } from "./salesforce";
import { normalizeWoType, getRForceResource } from "./normalize";
import { deriveTimesFromOrder } from "./rforce-times";
import { matchCrewByName } from "./crew-match";
import { clampMultiDaySpan } from "./scheduling-limits";
import { learnResourceMapping } from "./resource-learning";
import { getSchedulingMode, resolveScheduleTimes, deriveOccupancy } from "./scheduling-policy";

export interface MergeResult {
  appointment: Appointment;
  link: AppointmentLink | null;
  fieldsUpdated: string[];
  /** Warnings from non-critical operations (link, sync, audit) */
  warnings: string[];
}

// -- Per-field choices --

export type MergeSide = "app" | "rforce";
/** Fields where the app and rForce can disagree and the scheduler picks a side. */
export type MergeChoiceKey =
  | "date"
  | "time"
  | "crew"
  | "address"
  | "customer_name"
  | "appointment_type";
export type MergeChoices = Partial<Record<MergeChoiceKey, MergeSide>>;

/** Context needed only to resolve rForce's crew when the scheduler picks it. */
export interface MergeContext {
  crews: Crew[];
  mappings: ResourceMapping[];
}

export interface MergeConflict {
  key: MergeChoiceKey;
  label: string;
  app: string;
  rforce: string;
  /** Side pre-selected in the modal: schedule fields keep the app, text fields take rForce. */
  defaultSide: MergeSide;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * Every field where the tile and the rForce order disagree, ready for the
 * confirm modal. Pure. Times follow the same rule as the mismatch flags: a
 * measure only conflicts when rForce lands in a DIFFERENT block (10:30 inside a
 * 10-12 block is not a disagreement); timed jobs conflict at 30+ minutes apart.
 */
export function describeMergeConflicts(
  appointment: Appointment,
  rforceOrder: RForceOrder,
  crews: Crew[] = [],
  mappings: ResourceMapping[] = []
): MergeConflict[] {
  const out: MergeConflict[] = [];

  const rfDate = rforceOrder.scheduled_start?.slice(0, 10);
  if (rfDate && appointment.scheduled_date && rfDate !== appointment.scheduled_date) {
    out.push({ key: "date", label: "Date", app: appointment.scheduled_date, rforce: rfDate, defaultSide: "app" });
  }

  const derived = deriveTimesFromOrder(
    rforceOrder.scheduled_start,
    rforceOrder.scheduled_end,
    appointment.appointment_type
  );
  if (derived) {
    if (appointment.time_block && appointment.time_block !== "full_day" && appointment.time_block !== "remote") {
      if (derived.time_block && derived.time_block !== appointment.time_block) {
        out.push({ key: "time", label: "Time", app: appointment.time_block, rforce: derived.time_block, defaultSide: "app" });
      }
    } else if (
      !appointment.time_block &&
      appointment.start_time &&
      Math.abs(minutes(appointment.start_time) - minutes(derived.start_time)) >= 30
    ) {
      out.push({
        key: "time",
        label: "Time",
        app: `${appointment.start_time}-${appointment.end_time ?? ""}`,
        rforce: `${derived.start_time}-${derived.end_time}`,
        defaultSide: "app",
      });
    }
  }

  const resource = getRForceResource(rforceOrder);
  if (resource) {
    const rfCrew = matchCrewByName(resource, crews, mappings);
    if (rfCrew && rfCrew.id !== appointment.crew_id) {
      const appCrew = crews.find((c) => c.id === appointment.crew_id);
      out.push({ key: "crew", label: "Crew", app: appCrew?.name ?? "(unassigned)", rforce: rfCrew.name, defaultSide: "app" });
    }
  }

  if (rforceOrder.address && rforceOrder.address !== appointment.address) {
    out.push({ key: "address", label: "Address", app: appointment.address || "(none)", rforce: rforceOrder.address, defaultSide: "rforce" });
  }
  if (rforceOrder.customer_name && rforceOrder.customer_name !== appointment.customer_name) {
    out.push({ key: "customer_name", label: "Customer", app: appointment.customer_name || "(none)", rforce: rforceOrder.customer_name, defaultSide: "rforce" });
  }
  const mappedType = normalizeWoType(rforceOrder.work_order_type);
  if (mappedType !== null && mappedType !== appointment.appointment_type) {
    out.push({ key: "appointment_type", label: "Type", app: appointment.appointment_type, rforce: mappedType, defaultSide: "rforce" });
  }

  return out;
}

/**
 * Build the field-level updates without writing to DB.
 * Pure function — testable without mocks.
 */
export function buildMergeUpdates(
  appointment: Appointment,
  rforceOrder: RForceOrder,
  choices: MergeChoices = {},
  ctx?: MergeContext
): { updates: Partial<Appointment>; fieldsUpdated: string[] } {
  const updates: Partial<Appointment> = {};
  const fieldsUpdated: string[] = [];
  // Text fields default to rForce; the scheduler can keep their own.
  const takeRForce = (key: MergeChoiceKey) => choices[key] !== "app";

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

  if (takeRForce("address") && rforceOrder.address && rforceOrder.address !== appointment.address) {
    updates.address = rforceOrder.address;
    fieldsUpdated.push("address");
  }

  if (
    takeRForce("customer_name") &&
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
  if (takeRForce("appointment_type") && mappedType !== null && mappedType !== appointment.appointment_type) {
    updates.appointment_type = mappedType;
    fieldsUpdated.push("appointment_type");

    // A type change that changes the scheduling MODE (install → service, say)
    // must re-derive the placement fields, or a now-timed job keeps its
    // all-day block — the corruption 20260827_001 repaired. Same-mode changes
    // (service → JIP) keep their times untouched.
    const newMode = getSchedulingMode(mappedType);
    if (appointment.scheduled_date && newMode !== getSchedulingMode(appointment.appointment_type)) {
      const resolved = resolveScheduleTimes(
        mappedType,
        newMode === "timed"
          ? { startTime: appointment.start_time, endTime: appointment.end_time }
          : { timeBlock: appointment.time_block }
      );
      const occupancy = deriveOccupancy({
        timeBlock: resolved.timeBlock,
        startTime: resolved.start,
        endTime: resolved.end,
      });
      updates.time_block = resolved.timeBlock;
      updates.time_block_end = null;
      updates.start_time = resolved.start;
      updates.end_time = resolved.end;
      updates.is_full_day = occupancy.is_full_day;
      updates.resource_hours = occupancy.resource_hours;
      fieldsUpdated.push("scheduling");
    }
  }

  // -- Schedule fields: the app wins unless the scheduler picked rForce --

  if (choices.date === "rforce" && rforceOrder.scheduled_start) {
    const rfStart = rforceOrder.scheduled_start.slice(0, 10);
    if (rfStart !== appointment.scheduled_date) {
      updates.scheduled_date = rfStart;
      fieldsUpdated.push("scheduled_date");
    }
    const rfEnd = (rforceOrder.scheduled_end || rforceOrder.scheduled_start).slice(0, 10);
    const span = clampMultiDaySpan(
      Math.round((new Date(rfEnd).getTime() - new Date(rfStart).getTime()) / 86_400_000) + 1
    );
    if (span !== (appointment.duration_days || 1)) {
      updates.duration_days = span;
      fieldsUpdated.push("duration_days");
    }
  }

  if (choices.time === "rforce") {
    const type = updates.appointment_type ?? appointment.appointment_type;
    const derived = deriveTimesFromOrder(rforceOrder.scheduled_start, rforceOrder.scheduled_end, type);
    if (derived) {
      const occupancy = deriveOccupancy({
        timeBlock: derived.time_block,
        startTime: derived.start_time,
        endTime: derived.end_time,
      });
      updates.time_block = derived.time_block;
      updates.time_block_end = null;
      updates.start_time = derived.start_time;
      updates.end_time = derived.end_time;
      updates.is_full_day = occupancy.is_full_day;
      updates.resource_hours = occupancy.resource_hours;
      if (!fieldsUpdated.includes("scheduling")) fieldsUpdated.push("scheduling");
    }
  }

  if (choices.crew === "rforce" && ctx) {
    const resource = getRForceResource(rforceOrder);
    const rfCrew = resource ? matchCrewByName(resource, ctx.crews, ctx.mappings) : undefined;
    if (rfCrew && rfCrew.id !== appointment.crew_id) {
      updates.crew_id = rfCrew.id;
      fieldsUpdated.push("crew_id");
    }
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
  rforceOrder: RForceOrder,
  choices: MergeChoices = {},
  ctx?: MergeContext
): Promise<MergeResult> {
  const warnings: string[] = [];
  const { updates, fieldsUpdated } = buildMergeUpdates(appointment, rforceOrder, choices, ctx);

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
        choices,
      },
      reason: `Merged from rForce order ${rforceOrder.work_order_number}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Audit event not recorded: ${msg}`);
  }

  // ── Step 5: Learn resource mapping (fire-and-forget) ──
  // The appointment's crew_id is the scheduler-confirmed crew for this rForce order.
  // Skipped when the scheduler kept their own crew over a different rForce
  // resource - that would teach the mapping the wrong pairing.
  if (updated.crew_id && choices.crew !== "app") {
    learnResourceMapping(rforceOrder, updated.crew_id);
  }

  return { appointment: updated, link, fieldsUpdated, warnings };
}
