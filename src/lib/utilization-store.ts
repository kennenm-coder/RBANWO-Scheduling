/**
 * Data layer for the /metrics tab.
 *
 * Kept out of DataProvider on purpose: that provider loads on every route, and
 * a manager-only tab should not tax the calendar's startup.
 *
 * Three small reads, all indexed, NONE touching install_docs:
 *
 *   1. sched_appointments — nine columns, install-ish types, live statuses
 *   2. sched_install_tally — twelve smallints per order, precomputed by trigger
 *   3. weights + settings + targets — a few dozen rows
 *
 * No jsonb is read at query time and no document is de-TOASTed. See
 * INSTALLER_UTILIZATION_PLAN.md ("Database cost per page load") and migration
 * 20261008_001 for why the tally is precomputed rather than aggregated here.
 */

import { addDays, format, parseISO } from "date-fns";
import { getSupabase } from "./supabase";
import { MAX_MULTI_DAY_SPAN } from "./scheduling-limits";
import { getCrewAvailability } from "./availability";
import { getTimeOffForDate } from "./store";
import type {
  AvailabilityException,
  AvailabilityRule,
  CalendarBlock,
  Crew,
  TimeOffRequest,
} from "./types";
import {
  COUNTED_STATUSES,
  type InstallTally,
  type LoadWeight,
  type UtilizationAppointment,
  type UtilizationSettings,
} from "./utilization";

/** Exactly the columns `computeUtilization` reads. */
const APPOINTMENT_COLUMNS =
  "id, crew_id, secondary_crew_id, tertiary_crew_id, secondary_day_offsets, tertiary_day_offsets, appointment_type, order_number, work_order_number, customer_name, scheduled_date, duration_days, status";

const TALLY_COLUMNS =
  "job_id, order_number, windows_if, windows_ff, windows_ej, specialty_if, specialty_ff, specialty_ej, patio_doors, entry_doors, storm_doors, screens, other_units, total_units, doc_version, built_at";

/**
 * PostgREST sends `in` filters in the URL, so a few hundred order numbers would
 * blow the length limit. Chunked instead.
 */
const IN_CHUNK = 150;

const DEFAULT_SETTINGS: UtilizationSettings = {
  target_points_per_day: 12,
  goal_utilization_pct: 85,
  legacy_points_per_day: 6,
};

/**
 * Appointments whose SPAN overlaps [startDate, endDate].
 *
 * The window is widened backwards by MAX_MULTI_DAY_SPAN because
 * `scheduled_date` is a job's START: a 5-day install beginning the Friday
 * before the range still occupies four days inside it. Filtering on
 * `scheduled_date >= startDate` — which is what fetchAppointments() does for
 * the calendar — would drop those days and under-report that installer.
 */
export async function fetchUtilizationAppointments(
  startDate: string,
  endDate: string,
  installerCrewIds: string[]
): Promise<UtilizationAppointment[]> {
  const sb = getSupabase();
  if (!sb) return [];
  // No installers, nothing to ask for. Without this the crew filter would be
  // an empty `in ()` and the query would return the whole window.
  if (installerCrewIds.length === 0) return [];

  const widenedStart = format(
    addDays(parseISO(startDate), -MAX_MULTI_DAY_SPAN),
    "yyyy-MM-dd"
  );

  const { data, error } = await sb
    .from("sched_appointments")
    .select(APPOINTMENT_COLUMNS)
    .gte("scheduled_date", widenedStart)
    .lte("scheduled_date", endDate)
    .in("status", COUNTED_STATUSES as string[])
    // Installers only -- but across all three crew slots, not just the lead.
    // Filtering on crew_id alone hid every job where an installer was the
    // SECOND crew, so their week read as idle while they were on site. All of
    // an installer's appointment TYPES are still needed, since service and JIP
    // days are what make a day `non_install` rather than `idle`.
    .or(
      [
        `crew_id.in.(${installerCrewIds.join(",")})`,
        `secondary_crew_id.in.(${installerCrewIds.join(",")})`,
        `tertiary_crew_id.in.(${installerCrewIds.join(",")})`,
      ].join(",")
    )
    .order("scheduled_date", { ascending: true });

  // Throw rather than returning [] — a swallowed error here would render as
  // "everybody is idle", which is worse than an error message.
  if (error) throw error;
  return (data as unknown as UtilizationAppointment[]) ?? [];
}

/**
 * Tallies for the given order numbers, keyed by order number.
 *
 * `sched_install_tally` is keyed on job_id, not order_number, because a
 * re-created job can reuse a PO. When two tallies share an order number the
 * most recently built one wins — the same "newest save is the truth" rule the
 * material-list app applies to its own documents.
 */
export async function fetchInstallTallies(
  orderNumbers: string[]
): Promise<Map<string, InstallTally>> {
  const byOrder = new Map<string, InstallTally>();
  const sb = getSupabase();
  if (!sb) return byOrder;

  const unique = [...new Set(orderNumbers.map((o) => o.trim()).filter(Boolean))];
  if (unique.length === 0) return byOrder;

  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    const { data, error } = await sb
      .from("sched_install_tally")
      .select(TALLY_COLUMNS)
      .in("order_number", chunk);
    if (error) throw error;

    for (const row of (data as unknown as InstallTally[]) ?? []) {
      const key = row.order_number?.trim();
      if (!key) continue;
      const existing = byOrder.get(key);
      if (!existing || row.built_at > existing.built_at) byOrder.set(key, row);
    }
  }

  return byOrder;
}

export interface UtilizationConfig {
  weights: LoadWeight[];
  settings: UtilizationSettings;
  /** Per-crew target override. Empty in v1. */
  targets: Map<string, number>;
}

/**
 * Weights, company settings and per-installer overrides.
 *
 * Falls back to the seeded defaults if a table is unreachable, so a config
 * hiccup degrades to "the company numbers" rather than to a blank page. An
 * empty weight table would make everyone read 0%, so that case is reported.
 */
export async function fetchUtilizationConfig(): Promise<UtilizationConfig> {
  const sb = getSupabase();
  if (!sb) return { weights: [], settings: DEFAULT_SETTINGS, targets: new Map() };

  const [weightsRes, settingsRes, targetsRes] = await Promise.all([
    sb.from("sched_load_weights").select("product_key, frame_key, points"),
    sb
      .from("sched_utilization_settings")
      .select("target_points_per_day, goal_utilization_pct, legacy_points_per_day")
      .maybeSingle(),
    sb.from("sched_crew_targets").select("crew_id, target_points_per_day"),
  ]);

  if (weightsRes.error) throw weightsRes.error;

  const weights = ((weightsRes.data as LoadWeight[]) ?? []).map((w) => ({
    ...w,
    points: Number(w.points) || 0,
  }));

  const raw = settingsRes.data as UtilizationSettings | null;
  const settings: UtilizationSettings = {
    target_points_per_day:
      Number(raw?.target_points_per_day) > 0
        ? Number(raw!.target_points_per_day)
        : DEFAULT_SETTINGS.target_points_per_day,
    goal_utilization_pct:
      Number(raw?.goal_utilization_pct) > 0
        ? Number(raw!.goal_utilization_pct)
        : DEFAULT_SETTINGS.goal_utilization_pct,
    // Zero is a legitimate setting here ("legacy deals are worth nothing"), so
    // this checks for a finite number rather than a truthy one.
    legacy_points_per_day: Number.isFinite(Number(raw?.legacy_points_per_day))
      ? Math.max(0, Number(raw!.legacy_points_per_day))
      : DEFAULT_SETTINGS.legacy_points_per_day,
  };

  const targets = new Map<string, number>();
  for (const row of (targetsRes.data as
    | { crew_id: string; target_points_per_day: number | null }[]
    | null) ?? []) {
    const value = Number(row.target_points_per_day);
    if (value > 0) targets.set(row.crew_id, value);
  }

  return { weights, settings, targets };
}

/**
 * Build the `isOff` predicate `computeUtilization` needs.
 *
 * Two independent sources, same as the calendar's own day-blocking logic in
 * CrewBlockView:
 *   • external time off (`sched_time_off_requests`), matched on employee NAME
 *     and the crew's aliases — it comes from the HR sheet, not from crew ids
 *   • the availability engine (rules, exceptions, company-wide blocks), which
 *     covers PTO, unavailable, late day, office day, holidays and meetings
 *
 * Results are memoized per (crew, date): the grid asks for every pair in the
 * range, and `getCrewAvailability` re-filters every rule on each call.
 */
export function buildOffLookup(
  crews: Crew[],
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
  calendarBlocks: CalendarBlock[],
  timeOff: TimeOffRequest[]
): (crewId: string, date: string) => string | null {
  const crewById = new Map(crews.map((c) => [c.id, c]));
  const offNamesByDate = new Map<string, Set<string>>();
  const memo = new Map<string, string | null>();

  function namesOffOn(date: string): Set<string> {
    let names = offNamesByDate.get(date);
    if (!names) {
      names = new Set(
        getTimeOffForDate(timeOff, date).map((r) => r.employee_name.toLowerCase())
      );
      offNamesByDate.set(date, names);
    }
    return names;
  }

  return (crewId: string, date: string): string | null => {
    const key = `${crewId}|${date}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    let reason: string | null = null;
    const crew = crewById.get(crewId);

    if (crew) {
      const names = namesOffOn(date);
      const isOff =
        names.has(crew.name.toLowerCase()) ||
        (crew.aliases || []).some((a) => names.has(a.toLowerCase()));
      if (isOff) {
        reason = "Time Off";
      } else {
        const avail = getCrewAvailability(
          crewId,
          parseISO(date),
          rules,
          exceptions,
          calendarBlocks
        );
        if (!avail.available) reason = avail.reason || "Unavailable";
      }
    }

    memo.set(key, reason);
    return reason;
  };
}

/** Every date in [start, end] inclusive, `yyyy-MM-dd`. */
export function datesInRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cursor = parseISO(startDate);
  const end = parseISO(endDate);
  // Bounded so a reversed or absurd range can't spin forever.
  for (let i = 0; cursor <= end && i < 400; i++) {
    out.push(format(cursor, "yyyy-MM-dd"));
    cursor = addDays(cursor, 1);
  }
  return out;
}
