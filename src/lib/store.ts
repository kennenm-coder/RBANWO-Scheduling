import { getSupabase, requireSupabase } from "./supabase";
import {
  Appointment,
  AppointmentOrigin,
  SyncState,
  OriginalEntrySnapshot,
  Crew,
  RForceOrder,
  TimeOffRequest,
  AppointmentEvent,
  AvailabilityRule,
  AvailabilityException,
  AppointmentLink,
  ResourceMapping,
  RForceDismissal,
  FlagResolution,
  MatchRejection,
  TimeBlock,
} from "./types";
import { timeBlockStartEnd, formatDateStr } from "./calendar-utils";
import { buildSalesforceUrl } from "./salesforce";
import { normalizeWoType } from "./normalize";
import { learnResourceMapping } from "./resource-learning";
import { checkSchedulingConflicts, formatConflictMessage } from "./scheduling-validation";
import { deriveTimesFromOrder } from "./rforce-times";
import { getSchedulingMode, deriveOccupancy } from "./scheduling-policy";

// ── Crews ──

export async function fetchCrews(): Promise<Crew[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("sched_crews")
    .select("*")
    .order("sort_order", { ascending: true });
  return (data as Crew[]) ?? [];
}

export async function upsertCrew(
  crew: Partial<Crew> & { name: string; crew_type: string }
): Promise<Crew | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("sched_crews")
    .upsert({ ...crew, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Crew | null;
}

export async function deactivateCrew(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from("sched_crews")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function toggleCrewActive(id: string, isActive: boolean): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from("sched_crews")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);
}

// ── Appointments ──

export async function fetchAppointments(
  startDate: string,
  endDate: string
): Promise<Appointment[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("sched_appointments")
    .select("*")
    .gte("scheduled_date", startDate)
    .lte("scheduled_date", endDate)
    .neq("status", "cancelled")
    .order("scheduled_date", { ascending: true });
  // Throw on error rather than returning [] — a swallowed error here let a
  // transient failure overwrite the whole calendar with an empty list.
  if (error) throw error;
  return (data as Appointment[]) ?? [];
}

export async function createAppointment(
  appt: Omit<Appointment, "id" | "version" | "created_at" | "updated_at" | "origin" | "sync_state" | "original_entry_snapshot" | "last_reconciled_import_id"> & Partial<Pick<Appointment, "origin" | "sync_state" | "original_entry_snapshot" | "last_reconciled_import_id">>,
  existingAppointments?: Appointment[]
): Promise<Appointment | null> {
  // Pre-write conflict check — catches multi-day, multi-block, full-day, and secondary/tertiary crew conflicts
  // that the DB's partial unique index cannot detect.
  if (existingAppointments && appt.crew_id && appt.scheduled_date && appt.time_block) {
    const conflicts = checkSchedulingConflicts(
      appt.crew_id,
      appt.scheduled_date,
      appt.duration_days ?? 1,
      appt.time_block,
      appt.time_block_end ?? null,
      existingAppointments,
    );
    if (conflicts.length > 0) {
      throw new Error(`SCHEDULING_CONFLICT: ${formatConflictMessage(conflicts[0])}`);
    }
  }

  const sb = requireSupabase();
  const { data, error } = await sb
    .from("sched_appointments")
    .insert(appt)
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("DOUBLE_BOOK");
    }
    throw error;
  }
  return data as Appointment;
}

export async function updateAppointment(
  id: string,
  version: number,
  updates: Partial<Appointment>,
  existingAppointments?: Appointment[]
): Promise<Appointment | null> {
  // Pre-write conflict check when scheduling fields are changing.
  // Only runs when the caller provides existing appointments AND the update touches scheduling fields.
  if (existingAppointments && (updates.crew_id || updates.scheduled_date || updates.time_block)) {
    // Merge updates with current appointment to get the full picture.
    // Find the current appointment in the provided list so we can fill in unchanged fields.
    const current = existingAppointments.find((a) => a.id === id);
    if (current) {
      const crewId = updates.crew_id ?? current.crew_id;
      const scheduledDate = updates.scheduled_date ?? current.scheduled_date;
      const timeBlock = updates.time_block ?? current.time_block;
      const durationDays = updates.duration_days ?? current.duration_days;
      const timeBlockEnd = updates.time_block_end ?? current.time_block_end;

      if (crewId && scheduledDate && timeBlock) {
        const conflicts = checkSchedulingConflicts(
          crewId,
          scheduledDate,
          durationDays ?? 1,
          timeBlock,
          timeBlockEnd ?? null,
          existingAppointments,
          id, // exclude self
        );
        if (conflicts.length > 0) {
          throw new Error(`SCHEDULING_CONFLICT: ${formatConflictMessage(conflicts[0])}`);
        }
      }
    }
  }

  const sb = requireSupabase();
  // Strip sync-model fields — these are managed exclusively by updateSyncFields()
  // and sync-transitions.ts to prevent ad-hoc mutations from breaking the state machine.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { origin, sync_state, original_entry_snapshot, last_reconciled_import_id, ...safeUpdates } = updates;
  const { data, error } = await sb
    .from("sched_appointments")
    .update({
      ...safeUpdates,
      version: version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("version", version)
    .select()
    .single();
  if (error) {
    if (error.code === "PGRST116") {
      throw new Error("VERSION_CONFLICT");
    }
    if (error.code === "23505") {
      throw new Error("DOUBLE_BOOK");
    }
    // Preserve the DB message (e.g. the scheduling-conflict trigger's
    // "SCHEDULING_CONFLICT: …") as a real Error so callers can pattern-match it
    // instead of receiving a raw object that stringifies to "[object Object]".
    throw new Error(error.message || "Failed to update appointment");
  }
  return data as Appointment;
}

export async function cancelAppointment(
  id: string,
  version: number,
  reason?: string
): Promise<void> {
  await updateAppointment(id, version, {
    status: "cancelled",
    reschedule_reason: reason || null,
  });
}

/** Move an appointment back to the queue by setting status='unscheduled' and clearing scheduling fields. */
export async function unscheduleAppointment(
  id: string,
  version: number,
  reason?: string
): Promise<Appointment | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("sched_appointments")
    .update({
      status: "unscheduled",
      crew_id: null,
      scheduled_date: null,
      start_time: null,
      end_time: null,
      time_block: null,
      reschedule_reason: reason || "Unscheduled by user",
      version: version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("version", version)
    .select()
    .single();
  if (error) {
    if (error.code === "PGRST116") throw new Error("VERSION_CONFLICT");
    throw error;
  }
  return data as Appointment;
}

/** Fetch appointments with status='unscheduled' (not bound to a date range). */
export async function fetchUnscheduledAppointments(): Promise<Appointment[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("sched_appointments")
    .select("*")
    .eq("status", "unscheduled")
    .order("updated_at", { ascending: false });
  return (data as Appointment[]) ?? [];
}

// ── Sync State Transitions ──

/**
 * Controlled update of sync-model fields. Bypasses the ad-hoc strip in updateAppointment.
 * Uses optimistic concurrency when a version is provided — throws VERSION_CONFLICT if
 * another mutation raced ahead. When version is omitted, updates unconditionally
 * (used by background sync where we accept last-writer-wins).
 */
export async function updateSyncFields(
  id: string,
  fields: {
    origin?: AppointmentOrigin;
    sync_state?: SyncState;
    original_entry_snapshot?: OriginalEntrySnapshot | null;
    last_reconciled_import_id?: string | null;
  },
  version?: number
): Promise<void> {
  const sb = requireSupabase();
  const updatePayload: Record<string, unknown> = {
    ...fields,
    updated_at: new Date().toISOString(),
  };
  if (version !== undefined) {
    updatePayload.version = version + 1;
  }
  let query = sb
    .from("sched_appointments")
    .update(updatePayload)
    .eq("id", id);
  if (version !== undefined) {
    query = query.eq("version", version);
  }
  const { error, count } = await query;
  if (error) throw error;
  // When using version check, count=0 means the row was already modified
  if (version !== undefined && count === 0) {
    throw new Error("VERSION_CONFLICT");
  }
}

// ── rForce Orders (CSV import) ──

// Only fetch columns the scheduler actually renders or matches on.
// Dropping description, combined_retail_total, total_units, windows,
// patio_doors, doors, contact_name, email, phones, sales_rep, order_owner
// cuts each row roughly in half.
const RFORCE_COLUMNS = [
  "id", "order_number", "work_order_number", "status", "appointment_status",
  "work_order_type", "customer_name", "address", "scheduled_start",
  "scheduled_end", "product_count", "windows", "patio_doors", "doors",
  "primary_resource", "tech_measure", "installer", "service_rep",
  "order_alerts", "scheduler_notes", "account_name",
  "latitude", "longitude",
  "updated_at",
].join(", ");

export async function fetchRForceOrders(): Promise<RForceOrder[]> {
  const sb = getSupabase();
  if (!sb) return [];

  // Only fetch work orders with a scheduled_start in the last 90 days or
  // later — the scheduler never needs ancient completed history.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffISO = cutoff.toISOString();

  const all: RForceOrder[] = [];
  let offset = 0;
  const BATCH = 1000;
  while (true) {
    const { data } = await sb
      .from("work_orders")
      .select(RFORCE_COLUMNS)
      .neq("work_order_number", "")
      .not("work_order_number", "is", null)
      .or(`scheduled_start.gte.${cutoffISO},scheduled_start.is.null`)
      .range(offset, offset + BATCH - 1);
    if (!data || data.length === 0) break;
    all.push(
      ...(data as unknown as Record<string, unknown>[]).map((row) => ({
        id: row.id,
        order_number: row.order_number,
        work_order_number: row.work_order_number,
        order_status: row.status,
        wo_status: row.appointment_status,
        work_order_type: row.work_order_type,
        customer_name: row.customer_name,
        address: row.address,
        booking_date: null,
        scheduled_start: row.scheduled_start,
        scheduled_end: row.scheduled_end,
        description: null,
        combined_retail_total: null,
        product_count: row.product_count ?? null,
        total_units: null,
        windows: row.windows ?? null,
        patio_doors: row.patio_doors ?? null,
        doors: row.doors ?? null,
        order_owner: null,
        sales_rep: null,
        primary_resource: row.primary_resource,
        tech_measure_name: row.tech_measure,
        installer: row.installer,
        service_rep: row.service_rep,
        contact_name: null,
        email: null,
        phones: null,
        order_alerts: row.order_alerts || null,
        scheduler_notes: row.scheduler_notes || null,
        account_name: row.account_name || null,
        csv_import_id: null,
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        updated_at: row.updated_at,
      } as RForceOrder))
    );
    if (data.length < BATCH) break;
    offset += BATCH;
  }
  return all;
}

// ── Import-run log (daily-export cancellation detection) ──
//
// One row per day a full rForce daily export was observed. Powers the two-tier
// "dropped from rForce" detection — see src/lib/rforce-staleness.ts and
// docs/phase2-dropped-from-rforce.md. Power Automate writes work_orders directly
// with no app hook, so the app records each export it sees on load.

/** Observed full-export dates (`YYYY-MM-DD`), newest first. */
export async function fetchImportRunDates(): Promise<string[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("sched_import_runs")
    .select("run_date")
    .order("run_date", { ascending: false });
  return (data || []).map((r) => (r as { run_date: string }).run_date);
}

/**
 * Record that a full daily export was observed on `runDate` (idempotent per day).
 * Best-effort: a failure here must never block loading the calendar.
 */
export async function recordImportRun(runDate: string, orderCount: number): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from("sched_import_runs")
    .upsert({ run_date: runDate, order_count: orderCount }, { onConflict: "run_date", ignoreDuplicates: true });
}

/**
 * Every work-order number that already has a real, placed appointment ANYWHERE
 * on the calendar — regardless of the date window the calendar currently loads.
 *
 * "Placed" = non-cancelled and actually scheduled (has a date, not a queued
 * tile). This mirrors the DUPLICATE_WO condition in approveRForceOrder: such a
 * job can't be approved again because a tile already exists. The Issues view
 * uses this to avoid flagging a job as "missing" when its tile simply falls
 * outside the loaded 30-day-back window (e.g. an already-completed-on-calendar
 * past install). Only the WO number is fetched, so this stays cheap.
 */
export async function fetchScheduledWorkOrderNumbers(): Promise<string[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const all: string[] = [];
  let offset = 0;
  const BATCH = 1000;
  while (true) {
    const { data } = await sb
      .from("sched_appointments")
      .select("work_order_number")
      .neq("status", "cancelled")
      .neq("status", "unscheduled")
      .not("scheduled_date", "is", null)
      .not("work_order_number", "is", null)
      .range(offset, offset + BATCH - 1);
    if (!data || data.length === 0) break;
    all.push(
      ...(data as { work_order_number: string | null }[])
        .map((r) => r.work_order_number || "")
        .filter(Boolean)
    );
    if (data.length < BATCH) break;
    offset += BATCH;
  }
  return all;
}

// ── Appointment Links ──

export async function fetchActiveLinks(): Promise<AppointmentLink[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("sched_appointment_links")
    .select("*")
    .is("unlinked_at", null);
  return (data as AppointmentLink[]) ?? [];
}

export async function linkAppointment(
  appointmentId: string,
  appointmentVersion: number,
  rforceOrder: RForceOrder,
  matchMethod: AppointmentLink["match_method"] = "manual"
): Promise<AppointmentLink> {
  const sb = getSupabase();
  if (!sb) throw new Error("No database connection");

  const { data: link, error: linkError } = await sb
    .from("sched_appointment_links")
    .insert({
      appointment_id: appointmentId,
      source_system: "rforce",
      external_key: rforceOrder.id,
      work_order_number: rforceOrder.work_order_number,
      order_number: rforceOrder.order_number,
      match_method: matchMethod,
    })
    .select()
    .single();

  if (linkError) {
    if (linkError.code === "23505") {
      throw new Error("ALREADY_LINKED");
    }
    throw linkError;
  }

  await updateAppointment(appointmentId, appointmentVersion, {
    work_order_number: rforceOrder.work_order_number,
    order_number: rforceOrder.order_number,
    salesforce_url: rforceOrder.work_order_number
      ? `https://renewalbyandersen.my.site.com/rForceLEX/s/global-search/${rforceOrder.work_order_number}`
      : null,
  });

  return link as AppointmentLink;
}

export async function unlinkAppointment(
  linkId: string,
  reason: string
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from("sched_appointment_links")
    .update({
      unlinked_at: new Date().toISOString(),
      unlink_reason: reason,
    })
    .eq("id", linkId)
    .is("unlinked_at", null);
  if (error) throw error;
}

// ── Resource Mappings ──

export async function fetchResourceMappings(): Promise<ResourceMapping[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("sched_resource_mappings")
    .select("*")
    .eq("is_active", true);
  return (data as ResourceMapping[]) ?? [];
}

export async function upsertResourceMapping(
  rawName: string,
  crewId: string
): Promise<ResourceMapping | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("sched_resource_mappings")
    .upsert(
      { raw_name: rawName, crew_id: crewId, is_active: true, updated_at: new Date().toISOString() },
      { onConflict: "raw_name" }
    )
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ResourceMapping | null;
}

// ── Account/Address Lookup (for autofill) ──

export interface AccountSuggestion {
  address: string;
  account_name: string;
  customer_name: string | null;
}

export async function fetchAccountSuggestions(): Promise<AccountSuggestion[]> {
  const sb = getSupabase();
  if (!sb) return [];

  // Only look back 1 year for address suggestions — covers all repeat
  // customers without scanning the entire historical work_orders table.
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffISO = cutoff.toISOString();

  const all: AccountSuggestion[] = [];
  let offset = 0;
  const BATCH = 1000;
  const seen = new Set<string>();
  while (true) {
    const { data } = await sb
      .from("work_orders")
      .select("address, account_name, customer_name")
      .not("address", "is", null)
      .neq("address", "")
      .gte("updated_at", cutoffISO)
      .range(offset, offset + BATCH - 1);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const addr = (row.address || "").trim();
      if (!addr || seen.has(addr)) continue;
      seen.add(addr);
      all.push({
        address: addr,
        account_name: row.account_name || "",
        customer_name: row.customer_name || null,
      });
    }
    if (data.length < BATCH) break;
    offset += BATCH;
  }
  return all;
}

// ── Scheduler Notes (editable per work order) ──

export async function updateSchedulerNotes(
  workOrderId: string,
  notes: string
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from("work_orders")
    .update({ scheduler_notes: notes })
    .eq("id", workOrderId);
  return !error;
}

// ── Time Off (read from Duck Force table) ──

export async function fetchTimeOffRequests(): Promise<TimeOffRequest[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("time_off_requests")
    .select("*")
    .order("start_date", { ascending: true });
  return (data as TimeOffRequest[]) ?? [];
}

export async function createTimeOffRequest(
  req: Omit<TimeOffRequest, "id" | "created_at">
): Promise<TimeOffRequest | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("time_off_requests")
    .insert(req)
    .select()
    .single();
  if (error) throw error;
  return data as TimeOffRequest;
}

export async function updateTimeOffRequest(
  id: string,
  updates: Partial<Omit<TimeOffRequest, "id" | "created_at">>
): Promise<TimeOffRequest | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("time_off_requests")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as TimeOffRequest;
}

export async function deleteTimeOffRequest(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("time_off_requests").delete().eq("id", id);
  if (error) throw error;
}

// ── Appointment Events ──

export async function createAppointmentEvent(
  event: Omit<AppointmentEvent, "id" | "created_at">
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("sched_appointment_events").insert(event);
  if (error) {
    // Audit events are non-blocking — log but don't throw
    console.warn("[audit] Failed to record appointment event:", error.message);
  }
}

export async function fetchAppointmentEvents(
  appointmentId: string
): Promise<AppointmentEvent[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("sched_appointment_events")
    .select("*")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: false });
  return (data as AppointmentEvent[]) ?? [];
}

export function getTimeOffForDate(
  requests: TimeOffRequest[],
  dateStr: string
): TimeOffRequest[] {
  return requests.filter((r) => {
    const start = r.start_date;
    const end = r.end_date || r.start_date;
    return dateStr >= start && dateStr <= end;
  });
}

// ── Availability Rules ──

export async function fetchAvailabilityRules(): Promise<{
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
}> {
  const sb = getSupabase();
  if (!sb) return { rules: [], exceptions: [] };
  const { data } = await sb
    .from("sched_availability_rules")
    .select("*, sched_availability_exceptions(*)")
    .eq("is_active", true);
  if (!data) return { rules: [], exceptions: [] };
  const rules: AvailabilityRule[] = [];
  const exceptions: AvailabilityException[] = [];
  for (const row of data) {
    const { sched_availability_exceptions: excs, ...rule } = row;
    rules.push(rule as AvailabilityRule);
    if (Array.isArray(excs)) {
      exceptions.push(...(excs as AvailabilityException[]));
    }
  }
  return { rules, exceptions };
}

export async function upsertAvailabilityRule(
  rule: Partial<AvailabilityRule> & {
    crew_id: string;
    kind: AvailabilityRule["kind"];
    effective_start: string;
  }
): Promise<AvailabilityRule | null> {
  const sb = requireSupabase();

  // repeat_interval column is guaranteed by the authoritative schema
  const payload = { ...rule, updated_at: new Date().toISOString() };

  const { data, error } = await sb
    .from("sched_availability_rules")
    .upsert(payload)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as AvailabilityRule | null;
}

export async function deleteAvailabilityRule(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("sched_availability_rules")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function upsertAvailabilityException(
  exc: Omit<AvailabilityException, "id" | "created_at">
): Promise<AvailabilityException | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("sched_availability_exceptions")
    .upsert(exc)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as AvailabilityException | null;
}

export async function deleteAvailabilityException(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("sched_availability_exceptions")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ── rForce Dismissals ──

export async function fetchDismissals(): Promise<RForceDismissal[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("sched_rforce_dismissals").select("*");
  return (data as RForceDismissal[]) ?? [];
}

export async function dismissRForceOrder(
  workOrderNumber: string,
  rforceDate: string,
  rforceStartTime?: string,
  reason?: string
): Promise<RForceDismissal | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("sched_rforce_dismissals")
    .upsert(
      {
        work_order_number: workOrderNumber,
        rforce_date: rforceDate,
        rforce_start_time: rforceStartTime || null,
        reason: reason || null,
      },
      { onConflict: "work_order_number,rforce_date" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as RForceDismissal;
}

export async function undismissRForceOrder(
  workOrderNumber: string,
  rforceDate: string
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("sched_rforce_dismissals")
    .delete()
    .eq("work_order_number", workOrderNumber)
    .eq("rforce_date", rforceDate);
  if (error) throw error;
}

// ── Approve rForce Order (one-click create + link) ──
//
// Operation order (crash-recovery safe):
//   1. INSERT appointment (critical — if this fails, throw)
//   2. CREATE link        (non-critical — idempotent, ALREADY_LINKED is OK)
//   3. AUDIT event        (non-critical — fire-and-forget)
//
// The appointment's work_order_number field records intent, so a missing link
// can be detected and repaired by Phase 16 remediation.

export async function approveRForceOrder(
  rforceOrder: RForceOrder,
  crewId: string,
  tb: TimeBlock,
  scheduledDate: string,
  actorId?: string | null,
  actorName?: string | null,
  existingAppointments?: Appointment[],
  /** Bypass the double-booking guard (intentional same-slot overlap). Does NOT
   *  bypass the duplicate-work-order guard. */
  override: boolean = false
): Promise<{ appointment: Appointment; link: AppointmentLink | null; warnings: string[] }> {
  const warnings: string[] = [];
  const appointmentType = (normalizeWoType(rforceOrder.work_order_type) || "install") as Appointment["appointment_type"];
  const { start: blockStart, end: blockEnd } = timeBlockStartEnd(tb);
  // Carry the appointment's REAL rForce window instead of the time-block default.
  // The block used to drive the stored start/end, which stamped every full-day
  // default (services, JIPs, queue-dropped jobs) with 08:00–16:00 and drew an
  // all-day bar. `deriveTimesFromOrder` is the shared source of truth (also used
  // by the one-time backfill) so live approvals and repaired history agree.
  const derived = deriveTimesFromOrder(
    rforceOrder.scheduled_start,
    rforceOrder.scheduled_end,
    appointmentType
  );
  let start = blockStart;
  let end = blockEnd;
  // May be null for timed types (service/JIP), whose block grid places them by
  // start hour rather than in the full-day row.
  let timeBlockToStore: TimeBlock | null = tb;
  if (derived) {
    if (tb === "full_day") {
      // Default / queue placement — take the real window and its natural block.
      start = derived.start_time;
      end = derived.end_time;
      timeBlockToStore = derived.time_block;
    } else if (derived.start_time >= blockStart && derived.start_time < blockEnd) {
      // Scheduler explicitly chose this block; keep it but show the true time,
      // capped to the block so a whole-day window can't overflow the slot.
      start = derived.start_time;
      end = derived.end_time <= blockEnd ? derived.end_time : blockEnd;
      if (end <= start) end = blockEnd;
    }
  }

  // A timed type (service/JIP/HOA/JSV/paint) must never carry the full-day block
  // tag — that was the original corruption. When rForce carried no usable window,
  // default to a 1-hour placeholder instead of the full 08:00–16:00 block.
  if (getSchedulingMode(appointmentType) === "timed") {
    timeBlockToStore = null;
    if (!derived) {
      start = "08:00";
      end = "09:00";
    }
  }

  // Occupancy fields kept in lockstep with the block/time so the whole-day guard
  // and the views agree (installs → all-day flag; everyone else → hours).
  const occupancy = deriveOccupancy({ timeBlock: timeBlockToStore, startTime: start, endTime: end });

  // Compute duration from rForce date range (multi-day installs)
  let durationDays = 1;
  if (rforceOrder.scheduled_start && rforceOrder.scheduled_end) {
    const startDate = rforceOrder.scheduled_start.slice(0, 10);
    const endDate = rforceOrder.scheduled_end.slice(0, 10);
    if (startDate !== endDate) {
      const diffMs = new Date(endDate).getTime() - new Date(startDate).getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
      if (diffDays > 1 && diffDays <= 14) durationDays = diffDays;
    }
  }

  const sb = requireSupabase();

  // An appointment for this work order may already exist outside the calendar's
  // knowledge: a queued (unscheduled) tile, or one scheduled beyond the loaded
  // date window. Both keep their work_order_number, and the atomic RPC treats
  // ANY non-cancelled appointment as a duplicate — so a naive "Approve" would
  // dead-end on DUPLICATE_WO even when the scheduler just wants that tile placed
  // on the calendar. The approve button's job here is to PULL the existing tile
  // onto the calendar, not to mint a second one.
  //
  //   • Queued tile (unscheduled / no date) → place it on the calendar.
  //   • Already scheduled elsewhere         → genuine duplicate, refuse.
  const woTrimmed = (rforceOrder.work_order_number || "").trim();
  const normalizedWo = woTrimmed.toLowerCase();
  let existing: Appointment | null = null;
  if (woTrimmed) {
    const { data: candidates } = await sb
      .from("sched_appointments")
      .select("*")
      .neq("status", "cancelled")
      .ilike("work_order_number", `%${woTrimmed}%`);
    existing =
      ((candidates as Appointment[]) || []).find(
        (a) => (a.work_order_number || "").trim().toLowerCase() === normalizedWo
      ) || null;
  }

  if (existing) {
    const isQueued = existing.status === "unscheduled" || !existing.scheduled_date;
    if (!isQueued) {
      // Genuinely on the calendar already — never create a duplicate. Tell the
      // scheduler where it lives so they can move that one instead.
      const where = existing.scheduled_date
        ? `on ${formatDateStr(existing.scheduled_date)}`
        : "elsewhere";
      throw new Error(
        `DUPLICATE_WO: ${existing.customer_name || "This job"} is already scheduled ${where} — open that appointment to move it to this date`
      );
    }

    // Place the queued tile on the calendar rather than creating a second one.
    // Skip the double-booking check when the scheduler has chosen to override.
    if (existingAppointments && !override) {
      const conflicts = checkSchedulingConflicts(
        crewId,
        scheduledDate,
        durationDays,
        tb,
        null,
        existingAppointments,
        existing.id,
      );
      if (conflicts.length > 0) {
        throw new Error(`SCHEDULING_CONFLICT: ${formatConflictMessage(conflicts[0])}`);
      }
    }

    let scheduled: Appointment | null;
    try {
      scheduled = await updateAppointment(existing.id, existing.version, {
        crew_id: crewId,
        scheduled_date: scheduledDate,
        start_time: start,
        end_time: end,
        time_block: timeBlockToStore,
        is_full_day: occupancy.is_full_day,
        resource_hours: occupancy.resource_hours,
        duration_days: durationDays,
        status: "scheduled",
        // Overlap tag excludes this row from the double-booking unique index.
        ...(override ? { allow_overlap: true } : {}),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "DOUBLE_BOOK") {
        throw new Error("SCHEDULING_CONFLICT: That crew slot is already booked");
      }
      throw err;
    }
    if (!scheduled) throw new Error("Failed to place the queued appointment on the calendar");

    // Ensure a link ties this appointment to the rForce order (idempotent).
    let placedLink: AppointmentLink | null = null;
    try {
      placedLink = await linkAppointment(scheduled.id, scheduled.version, rforceOrder, "auto");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "ALREADY_LINKED") {
        warnings.push("Link already existed (idempotent)");
      } else {
        warnings.push(`Link not created: ${msg}`);
      }
    }

    try {
      await createAppointmentEvent({
        appointment_id: scheduled.id,
        action: "approved_from_rforce",
        actor_id: actorId || null,
        actor_name_snapshot: actorName || null,
        before_state: { status: existing.status, scheduled_date: existing.scheduled_date },
        after_state: {
          scheduled_date: scheduledDate,
          crew_id: crewId,
          time_block: timeBlockToStore,
          source: "rforce_approval_from_queue",
        },
        reason: "Placed queued appointment on calendar from rForce approval",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Audit event not recorded: ${msg}`);
    }

    learnResourceMapping(rforceOrder, crewId);
    return { appointment: scheduled, link: placedLink, warnings };
  }

  // ── No existing tile — create a new one ──
  // Pre-write conflict check — block the approval if it would double-book,
  // unless the scheduler has chosen to override.
  if (existingAppointments && !override) {
    const conflicts = checkSchedulingConflicts(
      crewId,
      scheduledDate,
      durationDays,
      tb,
      null,
      existingAppointments,
    );
    if (conflicts.length > 0) {
      throw new Error(`SCHEDULING_CONFLICT: ${formatConflictMessage(conflicts[0])}`);
    }
  }

  // Override path: insert directly with allow_overlap so the intentional
  // same-slot overlap is excluded from the double-booking unique index. (The
  // atomic RPC can't set allow_overlap, so it's bypassed only for overrides.
  // The work-order uniqueness index still protects against true duplicates.)
  if (override) {
    const { data: inserted, error: insErr } = await sb
      .from("sched_appointments")
      .insert({
        crew_id: crewId,
        appointment_type: appointmentType || "install",
        order_number: rforceOrder.order_number || null,
        work_order_number: woTrimmed,
        customer_name: rforceOrder.customer_name || "Unknown",
        address: rforceOrder.address || "",
        scheduled_date: scheduledDate,
        start_time: start,
        end_time: end,
        duration_days: durationDays,
        time_block: timeBlockToStore,
        is_full_day: occupancy.is_full_day,
        resource_hours: occupancy.resource_hours,
        status: "scheduled",
        product_count: rforceOrder.product_count ?? null,
        salesforce_url: buildSalesforceUrl(rforceOrder.work_order_number),
        scheduled_by: actorId || null,
        origin: "rforce_approved",
        sync_state: "linked_pending_confirmation",
        allow_overlap: true,
      })
      .select()
      .single();
    if (insErr || !inserted) {
      if (insErr?.code === "23505") {
        throw new Error(`DUPLICATE_WO: An active appointment for WO ${woTrimmed} already exists`);
      }
      throw new Error(insErr?.message || "Override approval failed");
    }
    const overrideAppt = inserted as Appointment;

    let overrideLink: AppointmentLink | null = null;
    try {
      overrideLink = await linkAppointment(overrideAppt.id, overrideAppt.version, rforceOrder, "auto");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "ALREADY_LINKED") warnings.push("Link already existed (idempotent)");
      else warnings.push(`Link not created: ${msg}`);
    }
    try {
      await createAppointmentEvent({
        appointment_id: overrideAppt.id,
        action: "approved_from_rforce",
        actor_id: actorId || null,
        actor_name_snapshot: actorName || null,
        before_state: null,
        after_state: { scheduled_date: scheduledDate, crew_id: crewId, time_block: timeBlockToStore, allow_overlap: true },
        reason: "Approved with double-booking override",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Audit event not recorded: ${msg}`);
    }
    learnResourceMapping(rforceOrder, crewId);
    return { appointment: overrideAppt, link: overrideLink, warnings };
  }

  const { data: rpcData, error: rpcError } = await sb.rpc("approve_rforce_order", {
    p_crew_id: crewId,
    p_appointment_type: appointmentType || "install",
    p_order_number: rforceOrder.order_number || null,
    p_work_order_number: rforceOrder.work_order_number.trim(),
    p_customer_name: rforceOrder.customer_name || "Unknown",
    p_address: rforceOrder.address || "",
    p_scheduled_date: scheduledDate,
    p_start_time: start,
    p_end_time: end,
    p_time_block: timeBlockToStore,
    p_product_count: rforceOrder.product_count ?? null,
    p_salesforce_url: buildSalesforceUrl(rforceOrder.work_order_number),
    p_rforce_order_id: rforceOrder.id,
    p_actor_id: actorId || null,
    p_actor_name: actorName || null,
    p_duration_days: durationDays,
  });
  if (rpcError) {
    const message = rpcError.message || "rForce confirmation failed";
    if (message.includes("DUPLICATE_WO")) {
      throw new Error(`DUPLICATE_WO: An active appointment for WO ${rforceOrder.work_order_number} already exists`);
    }
    // A raw unique-violation here (WO already checked above) is the double-book
    // index — surface it as a conflict so the override prompt can offer a bypass.
    if (rpcError.code === "23505") {
      throw new Error("SCHEDULING_CONFLICT: That crew slot is already booked");
    }
    if (message.includes("SCHEDULING_CONFLICT")) throw new Error(message);
    throw new Error(message);
  }

  const rpcResult = rpcData as { appointment_id?: string; link_id?: string } | null;
  if (!rpcResult?.appointment_id || !rpcResult.link_id) {
    throw new Error("rForce confirmation returned incomplete data");
  }
  const [{ data: atomicAppt, error: atomicApptError }, { data: atomicLink, error: atomicLinkError }] =
    await Promise.all([
      sb.from("sched_appointments").select("*").eq("id", rpcResult.appointment_id).single(),
      sb.from("sched_appointment_links").select("*").eq("id", rpcResult.link_id).single(),
    ]);
  if (atomicApptError || !atomicAppt) throw new Error(atomicApptError?.message || "Confirmed appointment could not be loaded");
  if (atomicLinkError || !atomicLink) throw new Error(atomicLinkError?.message || "Confirmed appointment link could not be loaded");

  learnResourceMapping(rforceOrder, crewId);
  return {
    appointment: atomicAppt as Appointment,
    link: atomicLink as AppointmentLink,
    warnings,
  };

  /* Legacy non-atomic confirmation path retained in git history only.
  // Guard: prevent duplicate appointments by work order number
  const { data: existingByWo } = await sb
    .from("sched_appointments")
    .select("id")
    .eq("work_order_number", rforceOrder.work_order_number)
    .neq("status", "cancelled")
    .limit(1);
  if (existingByWo && existingByWo.length > 0) {
    throw new Error(`DUPLICATE_WO: An appointment for WO ${rforceOrder.work_order_number} already exists`);
  }

  // Step 1: INSERT appointment (critical — throw on failure)
  const { data: appt, error } = await sb
    .from("sched_appointments")
    .insert({
      crew_id: crewId,
      secondary_crew_id: null,
      tertiary_crew_id: null,
      appointment_type: appointmentType || "install",
      order_number: rforceOrder.order_number || null,
      work_order_number: rforceOrder.work_order_number,
      customer_name: rforceOrder.customer_name || "Unknown",
      address: rforceOrder.address || "",
      scheduled_date: scheduledDate,
      start_time: start,
      end_time: end,
      duration_days: durationDays,
      time_block: timeBlockToStore,
      status: "scheduled",
      notes: null,
      reschedule_reason: null,
      product_count: rforceOrder.product_count ?? null,
      salesforce_url: buildSalesforceUrl(rforceOrder.work_order_number),
      scheduled_by: actorId || null,
      origin: "rforce_approved",
      sync_state: "linked_pending_confirmation",
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("DOUBLE_BOOK");
    }
    throw new Error(error.message || "Insert failed");
  }
  if (!appt) {
    throw new Error("Insert returned no data — check RLS policies on sched_appointments");
  }
  const typedAppt = appt as Appointment;

  // Step 2: Create link (non-critical — ALREADY_LINKED is idempotent)
  let link: AppointmentLink | null = null;
  try {
    link = await linkAppointment(typedAppt.id, typedAppt.version, rforceOrder, "auto");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "ALREADY_LINKED") {
      warnings.push("Link already existed (idempotent)");
    } else {
      console.warn("[approve] Link creation failed — appointment exists without link:", msg);
      warnings.push(`Link not created: ${msg}`);
    }
  }

  // Step 3: Audit event (fire-and-forget — never blocks approval)
  try {
    await createAppointmentEvent({
      appointment_id: typedAppt.id,
      action: "created",
      actor_id: actorId || null,
      actor_name_snapshot: actorName || null,
      before_state: null,
      after_state: { work_order_number: rforceOrder.work_order_number, source: "rforce_approval" },
      reason: "Approved from rForce import",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Audit event not recorded: ${msg}`);
  }

  // Step 4: Learn resource mapping (fire-and-forget)
  learnResourceMapping(rforceOrder, crewId);

  return { appointment: typedAppt, link, warnings };
  */
}

// ── Flag Resolutions ──

export async function fetchFlagResolutions(): Promise<FlagResolution[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("sched_flag_resolutions").select("*");
  return (data as FlagResolution[]) ?? [];
}

export async function resolveFlag(
  flagKey: string,
  notes?: string
): Promise<FlagResolution | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("sched_flag_resolutions")
    .upsert(
      { flag_key: flagKey, notes: notes || null },
      { onConflict: "flag_key" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as FlagResolution;
}

export async function unresolveFlag(flagKey: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("sched_flag_resolutions")
    .delete()
    .eq("flag_key", flagKey);
  if (error) throw error;
}

// ── Match Rejections ("not a match" memory) ──

export async function fetchMatchRejections(): Promise<MatchRejection[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("sched_match_rejections").select("*");
  return (data as MatchRejection[]) ?? [];
}

export async function rejectMatch(
  appointmentId: string,
  workOrderNumber: string,
  rejectedBy?: string | null,
  reason?: string
): Promise<MatchRejection | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("sched_match_rejections")
    .upsert(
      {
        appointment_id: appointmentId,
        work_order_number: workOrderNumber,
        rejected_by: rejectedBy || null,
        reason: reason || null,
      },
      { onConflict: "appointment_id,work_order_number" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as MatchRejection;
}

export async function unrejectMatch(
  appointmentId: string,
  workOrderNumber: string
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("sched_match_rejections")
    .delete()
    .eq("appointment_id", appointmentId)
    .eq("work_order_number", workOrderNumber);
  if (error) throw error;
}
