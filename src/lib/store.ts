import { getSupabase } from "./supabase";
import {
  Appointment,
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
  TimeBlock,
} from "./types";
import { timeBlockStartEnd } from "./calendar-utils";
import { buildSalesforceUrl } from "./salesforce";

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
  const sb = getSupabase();
  if (!sb) return null;
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
  const { data } = await sb
    .from("sched_appointments")
    .select("*")
    .gte("scheduled_date", startDate)
    .lte("scheduled_date", endDate)
    .neq("status", "cancelled")
    .order("scheduled_date", { ascending: true });
  return (data as Appointment[]) ?? [];
}

export async function createAppointment(
  appt: Omit<Appointment, "id" | "version" | "created_at" | "updated_at">
): Promise<Appointment | null> {
  const sb = getSupabase();
  if (!sb) return null;
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
  updates: Partial<Appointment>
): Promise<Appointment | null> {
  const sb = getSupabase();
  if (!sb) return null;
  // Strip fields that may not exist as DB columns yet
  const { manual_override, override_source, time_block_end, merge_source_wo, ...safeUpdates } = updates;
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
    throw error;
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
  const sb = getSupabase();
  if (!sb) return null;
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

// ── rForce Orders (CSV import) ──

export async function fetchRForceOrders(): Promise<RForceOrder[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const all: RForceOrder[] = [];
  let offset = 0;
  const BATCH = 1000;
  while (true) {
    const { data } = await sb
      .from("work_orders")
      .select("*")
      .neq("work_order_number", "")
      .not("work_order_number", "is", null)
      .range(offset, offset + BATCH - 1);
    if (!data || data.length === 0) break;
    all.push(
      ...(data as any[]).map((row) => ({
        id: row.id,
        order_number: row.order_number,
        work_order_number: row.work_order_number,
        order_status: row.status,
        wo_status: row.appointment_status,
        work_order_type: row.work_order_type,
        customer_name: row.customer_name,
        address: row.address,
        booking_date: row.booking_date,
        scheduled_start: row.scheduled_start,
        scheduled_end: row.scheduled_end,
        description: row.description || row.service_description || null,
        combined_retail_total: row.combined_retail_total ?? null,
        product_count: row.product_count ?? null,
        total_units: row.total_units ?? null,
        windows: row.windows ?? null,
        patio_doors: row.patio_doors ?? null,
        doors: row.doors ?? null,
        order_owner: row.order_owner,
        sales_rep: row.sales_rep,
        primary_resource: row.primary_resource,
        tech_measure_name: row.tech_measure,
        installer: row.installer,
        service_rep: row.service_rep,
        contact_name: row.contact_name,
        email: row.email,
        phones: row.phones,
        order_alerts: row.order_alerts || null,
        scheduler_notes: row.scheduler_notes || null,
        account_name: row.account_name || null,
        csv_import_id: null,
        updated_at: row.updated_at,
      } as RForceOrder))
    );
    if (data.length < BATCH) break;
    offset += BATCH;
  }
  return all;
}

/** @deprecated Use linkAppointment() which writes to sched_appointment_links */
export async function linkAppointmentToRForce(
  appointmentId: string,
  version: number,
  rforceOrder: RForceOrder
): Promise<Appointment | null> {
  return updateAppointment(appointmentId, version, {
    work_order_number: rforceOrder.work_order_number,
    order_number: rforceOrder.order_number,
    salesforce_url: rforceOrder.work_order_number
      ? `https://renewalbyandersen.my.site.com/rForceLEX/s/global-search/${rforceOrder.work_order_number}`
      : null,
  });
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
  const sb = getSupabase();
  if (!sb) return;
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
  const sb = getSupabase();
  if (!sb) return null;
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
  await sb.from("sched_appointment_events").insert(event);
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
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("sched_availability_rules")
    .upsert({ ...rule, updated_at: new Date().toISOString() })
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
  const sb = getSupabase();
  if (!sb) return null;
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
  try {
    const { data } = await sb.from("sched_rforce_dismissals").select("*");
    return (data as RForceDismissal[]) ?? [];
  } catch {
    // Table may not exist yet — return empty
    return [];
  }
}

export async function dismissRForceOrder(
  workOrderNumber: string,
  rforceDate: string,
  rforceStartTime?: string,
  reason?: string
): Promise<RForceDismissal | null> {
  const sb = getSupabase();
  if (!sb) return null;
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

const APPROVE_WO_TYPE_MAP: Record<string, string> = {
  "Tech Measure": "tech_measure",
  Install: "install",
  Service: "service",
  JIP: "jip",
};

export async function approveRForceOrder(
  rforceOrder: RForceOrder,
  crewId: string,
  tb: TimeBlock,
  scheduledDate: string
): Promise<{ appointment: Appointment; link: AppointmentLink } | null> {
  const { start, end } = timeBlockStartEnd(tb);
  const appointmentType = (rforceOrder.work_order_type
    ? APPROVE_WO_TYPE_MAP[rforceOrder.work_order_type]
    : "install") as Appointment["appointment_type"];

  const sb = getSupabase();
  if (!sb) return null;

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
      duration_days: 1,
      time_block: tb,
      status: "scheduled",
      notes: null,
      reschedule_reason: null,
      product_count: rforceOrder.product_count ?? null,
      salesforce_url: buildSalesforceUrl(rforceOrder.work_order_number),
      scheduled_by: null,
    })
    .select()
    .single();

  if (error || !appt) return null;
  const typedAppt = appt as Appointment;

  let link: AppointmentLink | null = null;
  try {
    link = await linkAppointment(typedAppt.id, typedAppt.version, rforceOrder, "auto");
  } catch {
    // Link may fail due to RLS — appointment is still valid
  }

  try {
    await createAppointmentEvent({
      appointment_id: typedAppt.id,
      action: "created",
      actor_id: null,
      actor_name_snapshot: null,
      before_state: null,
      after_state: { work_order_number: rforceOrder.work_order_number, source: "rforce_approval" },
      reason: "Approved from rForce import",
    });
  } catch {
    // Event logging is non-critical
  }

  return { appointment: typedAppt, link: link! };
}

// ── Flag Resolutions ──

export async function fetchFlagResolutions(): Promise<FlagResolution[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data } = await sb.from("sched_flag_resolutions").select("*");
    return (data as FlagResolution[]) ?? [];
  } catch {
    // Table may not exist yet — return empty
    return [];
  }
}

export async function resolveFlag(
  flagKey: string,
  notes?: string
): Promise<FlagResolution | null> {
  const sb = getSupabase();
  if (!sb) return null;
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
