import { getSupabase } from "./supabase";
import {
  Appointment,
  Crew,
  RForceOrder,
  CsvImport,
  TimeOffRequest,
  AppointmentEvent,
  AvailabilityRule,
  AvailabilityException,
} from "./types";

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
  const { data, error } = await sb
    .from("sched_appointments")
    .update({
      ...updates,
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

// ── rForce Orders (CSV import) ──

export async function fetchRForceOrders(): Promise<RForceOrder[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const all: RForceOrder[] = [];
  let offset = 0;
  const BATCH = 1000;
  while (true) {
    const { data } = await sb
      .from("sched_rforce_orders")
      .select("*")
      .range(offset, offset + BATCH - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as RForceOrder[]));
    if (data.length < BATCH) break;
    offset += BATCH;
  }
  return all;
}

export async function upsertRForceOrders(
  orders: Omit<RForceOrder, "updated_at">[],
  csvImportId: string
): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;

  const enriched = orders.map((o) => ({
    ...o,
    csv_import_id: csvImportId,
    updated_at: new Date().toISOString(),
  }));

  let upserted = 0;
  const BATCH = 500;
  for (let i = 0; i < enriched.length; i += BATCH) {
    const batch = enriched.slice(i, i + BATCH);
    const { data } = await sb
      .from("sched_rforce_orders")
      .upsert(batch, { onConflict: "id" })
      .select("id");
    upserted += data?.length ?? 0;
  }
  return upserted;
}

export async function createCsvImport(
  record: Omit<CsvImport, "id" | "imported_at">
): Promise<CsvImport | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("sched_csv_imports")
    .insert(record)
    .select()
    .single();
  return data as CsvImport | null;
}

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
