/**
 * Data layer for the /activity log.
 *
 * Reads: sched_appointment_events (joined to its appointment for customer / WO /
 * date) and sched_activity_events (availability rules, company blocks, hard
 * deletes). Writes: logActivityEvent() for the second table only — appointment
 * events keep going through createAppointmentEvent() in store.ts.
 *
 * Paging is a timestamp cursor, not an offset: each source is asked for its next
 * `pageSize` rows at-or-before the cursor, mergeFeeds() interleaves them, and the
 * oldest row shown becomes the next cursor. An offset would have to be applied
 * to a merge of two tables; the cursor keeps each query a plain indexed range.
 */

import { getSupabase } from "./supabase";
import { getCurrentActor } from "./current-actor";
import {
  type ActivityEntry,
  type ActivityFilters,
  type AppointmentEventRow,
  type ConfigEventRow,
  appointmentDbActions,
  configActionPairs,
  dayRangeToIso,
  distinctActors,
  mergeFeeds,
  normalizeAppointmentEvent,
  normalizeConfigEvent,
  sanitizeSearch,
  sourcesForActions,
} from "./activity-log";

export const ACTIVITY_PAGE_SIZE = 50;

const APPT_SELECT = "*, appointment:sched_appointments{INNER}(customer_name, work_order_number, order_number, scheduled_date, crew_id)";

export interface ActivityPage {
  entries: ActivityEntry[];
  cursor: string | null;
  hasMore: boolean;
  /** Set when the config table could not be read (migration not applied yet). */
  configError: string | null;
}

/**
 * Fetch the next page of the activity feed.
 * `cursor` is the `at` of the oldest entry already shown (inclusive re-fetch;
 * `known` de-duplicates). Throws only when the appointment-events read fails.
 */
export async function fetchActivityPage(
  filters: ActivityFilters,
  cursor: string | null,
  known: ReadonlySet<string>,
  pageSize: number = ACTIVITY_PAGE_SIZE
): Promise<ActivityPage> {
  const sb = getSupabase();
  if (!sb) return { entries: [], cursor: null, hasMore: false, configError: null };

  const search = sanitizeSearch(filters.search);
  const { gte, lt } = dayRangeToIso(filters.from, filters.to);
  const want = sourcesForActions(filters.actions);

  const apptRun = async (): Promise<ActivityEntry[]> => {
    if (!want.appointment) return [];
    let q = sb
      .from("sched_appointment_events")
      .select(APPT_SELECT.replace("{INNER}", search ? "!inner" : ""));
    const dbActions = appointmentDbActions(filters.actions);
    if (filters.actions.length > 0) q = q.in("action", dbActions);
    if (filters.actor) q = q.eq("actor_name_snapshot", filters.actor);
    if (gte) q = q.gte("created_at", gte);
    if (lt) q = q.lt("created_at", lt);
    if (cursor) q = q.lte("created_at", cursor);
    if (search) {
      q = q.or(
        `customer_name.ilike.%${search}%,work_order_number.ilike.%${search}%,order_number.ilike.%${search}%`,
        { referencedTable: "appointment" }
      );
    }
    const { data, error } = await q.order("created_at", { ascending: false }).limit(pageSize);
    if (error) throw new Error(error.message || "Could not load the activity log");
    return ((data ?? []) as unknown as AppointmentEventRow[]).map(normalizeAppointmentEvent);
  };

  let configError: string | null = null;
  const configRun = async (): Promise<ActivityEntry[]> => {
    if (!want.config) return [];
    const pairs = configActionPairs(filters.actions);
    let q = sb.from("sched_activity_events").select("*");
    if (filters.actions.length > 0) {
      // (entity_type = X and action = Y) or ...
      q = q.or(pairs.map((p) => `and(entity_type.eq.${p.entityType},action.eq.${p.dbAction})`).join(","));
    }
    if (filters.actor) q = q.eq("actor_name_snapshot", filters.actor);
    if (gte) q = q.gte("created_at", gte);
    if (lt) q = q.lt("created_at", lt);
    if (cursor) q = q.lte("created_at", cursor);
    if (search) q = q.ilike("summary", `%${search}%`);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(pageSize);
    if (error) {
      // The table ships in a migration; until it is applied the appointment half
      // of the log must still work.
      configError = error.message || "Could not load availability / settings activity";
      return [];
    }
    return ((data ?? []) as ConfigEventRow[]).map(normalizeConfigEvent);
  };

  const [appt, config] = await Promise.all([apptRun(), configRun()]);
  const merged = mergeFeeds([appt, config], pageSize, known);
  return { ...merged, configError };
}

/** Distinct people who have acted recently — fills the "User" dropdown. */
export async function fetchActivityActors(): Promise<string[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const [a, c] = await Promise.all([
    sb
      .from("sched_appointment_events")
      .select("actor_name_snapshot")
      .not("actor_name_snapshot", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000),
    sb
      .from("sched_activity_events")
      .select("actor_name_snapshot")
      .not("actor_name_snapshot", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  return distinctActors([
    ...((a.data ?? []) as Array<{ actor_name_snapshot: string | null }>),
    ...((c.data ?? []) as Array<{ actor_name_snapshot: string | null }>),
  ]);
}

export interface ActivityEventInput {
  entityType: "availability_rule" | "calendar_block" | "appointment";
  entityId: string | null;
  action: "created" | "updated" | "deleted";
  summary: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Record a non-appointment change. Never throws: an audit write must not turn a
 * successful rule save into an error toast (same stance as createAppointmentEvent).
 */
export async function logActivityEvent(input: ActivityEventInput): Promise<void> {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const actor = getCurrentActor();
    const { error } = await sb.from("sched_activity_events").insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      actor_id: actor.id,
      actor_name_snapshot: actor.name,
      summary: input.summary,
      reason: input.reason ?? null,
      before_state: input.before ?? null,
      after_state: input.after ?? null,
    });
    if (error) console.warn("[audit] Failed to record activity event:", error.message);
  } catch (err) {
    console.warn("[audit] Failed to record activity event:", err);
  }
}
