/**
 * Installer utilization — the math behind the /metrics tab.
 *
 * One question per installer per day: is this person carrying a full day of
 * work? The measure is PRODUCT WORKLOAD, not calendar occupancy — a day with
 * five 2-unit jobs is not a full day, and the calendar cannot tell you that.
 *
 * A full install day is `target_points_per_day` points (12 by default).
 * Calibrated so that 6 inserts, 4 full frames, or 2 entry/patio doors each come
 * to exactly one day. Weights live in `sched_load_weights`, not here, so
 * retuning them is a data change.
 *
 * Deliberately a LEAF module: types, `crew-days` (span expansion) and nothing
 * else. Availability and the data layer are injected as arguments, which is
 * what makes the whole thing testable without a database. Same discipline as
 * scheduling-limits.ts.
 *
 * See INSTALLER_UTILIZATION_PLAN.md and migration 20261008_001.
 */

import type { Appointment, AppointmentType, Crew } from "./types";
import { getSpannedDates } from "./crew-days";

/**
 * The only appointment columns this module reads. Narrower than `Appointment`
 * so the store can `select` nine columns instead of `*` — the calendar's full
 * row is wide, and nothing here needs the sync-model or audit fields.
 *
 * A full `Appointment` satisfies this structurally, so callers can pass either.
 */
export type UtilizationAppointment = Pick<
  Appointment,
  | "id"
  | "crew_id"
  | "appointment_type"
  | "order_number"
  | "work_order_number"
  | "customer_name"
  | "scheduled_date"
  | "duration_days"
  | "status"
>;

// ─── Shape of the precomputed tally ─────────────────────────────────────────

export type ProductKey =
  | "window"
  | "specialty"
  | "patio_door"
  | "entry_door"
  | "storm_door"
  | "screen"
  | "other";

export type FrameKey = "IF" | "FF" | "EJ" | "NA";

/** One row of `sched_install_tally`, written by trigger from install_docs. */
export interface InstallTally {
  job_id: string;
  order_number: string | null;
  windows_if: number;
  windows_ff: number;
  windows_ej: number;
  specialty_if: number;
  specialty_ff: number;
  specialty_ej: number;
  patio_doors: number;
  entry_doors: number;
  storm_doors: number;
  screens: number;
  other_units: number;
  total_units: number;
  doc_version: number | null;
  built_at: string;
}

export interface LoadWeight {
  product_key: ProductKey;
  frame_key: FrameKey;
  points: number;
}

export interface UtilizationSettings {
  target_points_per_day: number;
  goal_utilization_pct: number;
}

/** Points per (product, frame), keyed `product|frame`. */
export type WeightMap = Map<string, number>;

export function weightKey(product: ProductKey, frame: FrameKey): string {
  return `${product}|${frame}`;
}

export function buildWeightMap(weights: LoadWeight[]): WeightMap {
  const map: WeightMap = new Map();
  for (const w of weights) {
    map.set(weightKey(w.product_key, w.frame_key), Number(w.points) || 0);
  }
  return map;
}

// ─── Product buckets ────────────────────────────────────────────────────────

/**
 * Every bucket the SQL tally produces, in display order, paired with the tally
 * column it reads. Exhaustive on purpose: adding a column to the migration
 * without adding it here would silently drop those units from the points
 * total, which is the failure mode this list exists to prevent.
 */
export const TALLY_BUCKETS: ReadonlyArray<{
  field: keyof InstallTally;
  product: ProductKey;
  frame: FrameKey;
  label: string;
  short: string;
}> = [
  { field: "windows_if", product: "window", frame: "IF", label: "Insert windows", short: "W-IF" },
  { field: "windows_ff", product: "window", frame: "FF", label: "Full-frame windows", short: "W-FF" },
  { field: "windows_ej", product: "window", frame: "EJ", label: "EJ-frame windows", short: "W-EJ" },
  { field: "specialty_if", product: "specialty", frame: "IF", label: "Insert specialty", short: "SP-IF" },
  { field: "specialty_ff", product: "specialty", frame: "FF", label: "Full-frame specialty", short: "SP-FF" },
  { field: "specialty_ej", product: "specialty", frame: "EJ", label: "EJ-frame specialty", short: "SP-EJ" },
  { field: "patio_doors", product: "patio_door", frame: "NA", label: "Patio doors", short: "PTD" },
  { field: "entry_doors", product: "entry_door", frame: "NA", label: "Entry doors", short: "ED" },
  { field: "storm_doors", product: "storm_door", frame: "NA", label: "Storm doors", short: "SD" },
  { field: "screens", product: "screen", frame: "NA", label: "Screens", short: "SN" },
  { field: "other_units", product: "other", frame: "NA", label: "Unclassified", short: "?" },
];

export interface BucketCount {
  product: ProductKey;
  frame: FrameKey;
  label: string;
  short: string;
  count: number;
  points: number;
}

/** Non-zero buckets on a tally, with their point contribution. */
export function tallyBreakdown(tally: InstallTally, weights: WeightMap): BucketCount[] {
  const out: BucketCount[] = [];
  for (const b of TALLY_BUCKETS) {
    const count = Number(tally[b.field]) || 0;
    if (count === 0) continue;
    const per = weights.get(weightKey(b.product, b.frame)) ?? 0;
    out.push({
      product: b.product,
      frame: b.frame,
      label: b.label,
      short: b.short,
      count,
      points: count * per,
    });
  }
  return out;
}

/** Total points a job is worth. */
export function tallyPoints(tally: InstallTally, weights: WeightMap): number {
  let total = 0;
  for (const b of TALLY_BUCKETS) {
    const count = Number(tally[b.field]) || 0;
    if (count === 0) continue;
    total += count * (weights.get(weightKey(b.product, b.frame)) ?? 0);
  }
  return total;
}

// ─── What counts ────────────────────────────────────────────────────────────

/**
 * The only appointment type that carries product load. Everything else on an
 * installer's calendar consumes their day without a material list behind it.
 *
 * `lswp` is deliberately NOT here: it is lead-safe setup work that rides along
 * with an install rather than its own product list, so counting it would double
 * the day it accompanies.
 */
export const LOAD_BEARING_TYPES: ReadonlyArray<AppointmentType> = ["install"];

/** Statuses that represent real work on the board. */
export const COUNTED_STATUSES: ReadonlyArray<string> = [
  "scheduled",
  "confirmed",
  "in_progress",
  "complete",
];

/** Resource types this tab reports on — install leads, in-house and sub. */
export const INSTALLER_CREW_TYPES: ReadonlyArray<string> = [
  "install_in_house",
  "install_sub",
];

export function isInstallerCrew(crew: Crew): boolean {
  if (!crew.is_active) return false;
  if (INSTALLER_CREW_TYPES.includes(crew.crew_type)) return true;
  return (crew.additional_types || []).some((t) => INSTALLER_CREW_TYPES.includes(t));
}

// ─── Day classification ─────────────────────────────────────────────────────

/**
 * - `measurable`  install work, every job has a material list → counted
 * - `idle`        available, nothing booked → the under-utilization signal
 * - `non_install` service / JIP / LSWP etc. → consumes the day, carries no load
 * - `unmeasured`  an install job with NO material list → excluded from BOTH
 *                 sides of the ratio, and flagged
 * - `off`         PTO, holiday, company meeting, unavailable → no capacity
 *
 * `unmeasured` excludes the whole day on purpose. Dropping just the job's load
 * while keeping its day in the denominator would make that installer read
 * artificially under-utilized — the exact wrong signal on a tab whose job is
 * spotting under-utilization.
 */
export type DayClass = "measurable" | "idle" | "non_install" | "unmeasured" | "off";

/** Day classes that contribute to the utilization ratio. */
const COUNTED_CLASSES: ReadonlyArray<DayClass> = ["measurable", "idle", "non_install"];

export interface DayJob {
  appointmentId: string;
  orderNumber: string | null;
  workOrderNumber: string | null;
  customerName: string;
  appointmentType: AppointmentType;
  /** Carries product load (an install), as opposed to service/JIP/etc. */
  loadBearing: boolean;
  /** False for an install with no material list — the flagged case. */
  hasTally: boolean;
  /** Days the job spans. */
  spanDays: number;
  /** The whole job's points. */
  jobPoints: number;
  /** This day's share — `jobPoints / spanDays`. */
  dayPoints: number;
  breakdown: BucketCount[];
}

export interface CrewDay {
  crewId: string;
  date: string;
  dayClass: DayClass;
  /** Points landing on this day. Zero for every class but `measurable`. */
  points: number;
  /** Target points for this day. Zero for `off` and `unmeasured`. */
  capacity: number;
  jobs: DayJob[];
  /** Why the day is `off`. */
  offReason?: string;
}

export interface CrewUtilization {
  crew: Crew;
  days: CrewDay[];
  totalPoints: number;
  capacity: number;
  /** Null when capacity is zero — no measurable days, so no honest answer. */
  utilizationPct: number | null;
  measurableDays: number;
  idleDays: number;
  nonInstallDays: number;
  unmeasuredDays: number;
  offDays: number;
  /** Counted days that came in under the goal. */
  underGoalDays: number;
  /** Install jobs with no material list, so somebody can go build one. */
  missingTallyJobs: DayJob[];
}

export interface UtilizationInput {
  crews: Crew[];
  /** Dates in range, `yyyy-MM-dd`, ascending. */
  dates: string[];
  appointments: UtilizationAppointment[];
  /** Tally by order number. Callers resolve duplicate order numbers first. */
  tallyByOrder: Map<string, InstallTally>;
  weights: WeightMap;
  settings: UtilizationSettings;
  /** Per-crew target override; falls back to the company number. */
  targets?: Map<string, number>;
  /** Reason this crew is off that day, or null when workable. */
  isOff: (crewId: string, date: string) => string | null;
}

function targetFor(
  crewId: string,
  targets: Map<string, number> | undefined,
  settings: UtilizationSettings
): number {
  const override = targets?.get(crewId);
  if (override && override > 0) return override;
  return settings.target_points_per_day > 0 ? settings.target_points_per_day : 12;
}

/**
 * Index appointments by `crewId|date` for the LEAD crew only.
 *
 * Helpers (secondary/tertiary) are out of scope for v1 — this tab reports on
 * leads, and crediting a helper with the lead's product count would
 * double-count the job.
 */
function indexLeadDays(
  appointments: UtilizationAppointment[]
): Map<string, UtilizationAppointment[]> {
  const byCrewDay = new Map<string, UtilizationAppointment[]>();
  for (const appt of appointments) {
    if (!appt.crew_id || !appt.scheduled_date) continue;
    if (!COUNTED_STATUSES.includes(appt.status)) continue;
    for (const date of getSpannedDates(appt.scheduled_date, appt.duration_days)) {
      const key = `${appt.crew_id}|${date}`;
      const list = byCrewDay.get(key);
      if (list) list.push(appt);
      else byCrewDay.set(key, [appt]);
    }
  }
  return byCrewDay;
}

function buildDayJob(
  appt: UtilizationAppointment,
  tallyByOrder: Map<string, InstallTally>,
  weights: WeightMap
): DayJob {
  const loadBearing = LOAD_BEARING_TYPES.includes(appt.appointment_type);
  const order = appt.order_number?.trim() || "";
  const tally = order ? tallyByOrder.get(order) : undefined;
  const spanDays = Math.max(1, appt.duration_days || 1);
  const breakdown = tally ? tallyBreakdown(tally, weights) : [];
  const jobPoints = tally ? tallyPoints(tally, weights) : 0;
  return {
    appointmentId: appt.id,
    orderNumber: appt.order_number,
    workOrderNumber: appt.work_order_number,
    customerName: appt.customer_name,
    appointmentType: appt.appointment_type,
    loadBearing,
    // Only load-bearing work NEEDS a tally; a service call is not "missing" one.
    hasTally: loadBearing ? !!tally : true,
    spanDays,
    jobPoints,
    dayPoints: jobPoints / spanDays,
    breakdown,
  };
}

function classifyDay(
  crewId: string,
  date: string,
  jobs: DayJob[],
  target: number,
  offReason: string | null
): CrewDay {
  if (offReason) {
    return { crewId, date, dayClass: "off", points: 0, capacity: 0, jobs, offReason };
  }

  const installJobs = jobs.filter((j) => j.loadBearing);

  // An install with no material list takes the whole day out of the ratio.
  if (installJobs.some((j) => !j.hasTally)) {
    return { crewId, date, dayClass: "unmeasured", points: 0, capacity: 0, jobs };
  }

  if (installJobs.length > 0) {
    const points = installJobs.reduce((sum, j) => sum + j.dayPoints, 0);
    return { crewId, date, dayClass: "measurable", points, capacity: target, jobs };
  }

  if (jobs.length > 0) {
    return { crewId, date, dayClass: "non_install", points: 0, capacity: target, jobs };
  }

  return { crewId, date, dayClass: "idle", points: 0, capacity: target, jobs };
}

/** Build one row per installer: the day grid plus its range rollup. */
export function computeUtilization(input: UtilizationInput): CrewUtilization[] {
  const { crews, dates, appointments, tallyByOrder, weights, settings, targets, isOff } = input;
  const byCrewDay = indexLeadDays(appointments);
  const goalFraction = settings.goal_utilization_pct / 100;

  const rows: CrewUtilization[] = [];

  for (const crew of crews) {
    const target = targetFor(crew.id, targets, settings);
    const days: CrewDay[] = [];

    for (const date of dates) {
      const appts = byCrewDay.get(`${crew.id}|${date}`) || [];
      const jobs = appts.map((a) => buildDayJob(a, tallyByOrder, weights));
      days.push(classifyDay(crew.id, date, jobs, target, isOff(crew.id, date)));
    }

    let totalPoints = 0;
    let capacity = 0;
    let measurableDays = 0;
    let idleDays = 0;
    let nonInstallDays = 0;
    let unmeasuredDays = 0;
    let offDays = 0;
    let underGoalDays = 0;
    const missingTallyJobs: DayJob[] = [];
    const seenMissing = new Set<string>();

    for (const day of days) {
      totalPoints += day.points;
      capacity += day.capacity;

      if (day.dayClass === "measurable") measurableDays++;
      else if (day.dayClass === "idle") idleDays++;
      else if (day.dayClass === "non_install") nonInstallDays++;
      else if (day.dayClass === "unmeasured") unmeasuredDays++;
      else if (day.dayClass === "off") offDays++;

      if (COUNTED_CLASSES.includes(day.dayClass) && day.capacity > 0) {
        if (day.points / day.capacity < goalFraction) underGoalDays++;
      }

      for (const job of day.jobs) {
        // One entry per job, not per day it spans.
        if (!job.hasTally && !seenMissing.has(job.appointmentId)) {
          seenMissing.add(job.appointmentId);
          missingTallyJobs.push(job);
        }
      }
    }

    rows.push({
      crew,
      days,
      totalPoints,
      capacity,
      utilizationPct: capacity > 0 ? (totalPoints / capacity) * 100 : null,
      measurableDays,
      idleDays,
      nonInstallDays,
      unmeasuredDays,
      offDays,
      underGoalDays,
      missingTallyJobs,
    });
  }

  return rows;
}

// ─── Presentation helpers ───────────────────────────────────────────────────

export type UtilBand = "none" | "low" | "warn" | "good" | "over";

/** Red below 70%, amber up to the goal, green at goal, blue when overloaded. */
export function utilizationBand(pct: number | null, goalPct: number): UtilBand {
  if (pct === null || !Number.isFinite(pct)) return "none";
  // Keep the bands ordered even if somebody sets the goal below 70.
  const lowCut = Math.min(70, goalPct);
  if (pct < lowCut) return "low";
  if (pct < goalPct) return "warn";
  if (pct <= 110) return "good";
  return "over";
}

/**
 * Ascending by utilization so the under-utilized float to the top. Rows with
 * no capacity sort LAST — "no data" is not the same as "nobody working", and
 * putting them first would bury the people who actually need a job.
 */
export function sortByUtilization(rows: CrewUtilization[]): CrewUtilization[] {
  return [...rows].sort((a, b) => {
    if (a.utilizationPct === null && b.utilizationPct === null) {
      return a.crew.name.localeCompare(b.crew.name);
    }
    if (a.utilizationPct === null) return 1;
    if (b.utilizationPct === null) return -1;
    if (a.utilizationPct !== b.utilizationPct) return a.utilizationPct - b.utilizationPct;
    return a.crew.name.localeCompare(b.crew.name);
  });
}

/** Points, trimmed: 12 not 12.00, 7.5 not 7.50. */
export function formatPoints(points: number): string {
  if (!Number.isFinite(points)) return "0";
  const rounded = Math.round(points * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export interface CoverageSummary {
  /** Distinct install jobs in range with a material list. */
  measuredJobs: number;
  /** Distinct install jobs in range with none — excluded and flagged. */
  missingJobs: number;
  unmeasuredDays: number;
}

/** The honesty line for the top of the page. */
export function summarizeCoverage(rows: CrewUtilization[]): CoverageSummary {
  const measured = new Set<string>();
  const missing = new Set<string>();
  let unmeasuredDays = 0;

  for (const row of rows) {
    unmeasuredDays += row.unmeasuredDays;
    for (const day of row.days) {
      for (const job of day.jobs) {
        if (!job.loadBearing) continue;
        if (job.hasTally) measured.add(job.appointmentId);
        else missing.add(job.appointmentId);
      }
    }
  }

  return {
    measuredJobs: measured.size,
    missingJobs: missing.size,
    unmeasuredDays,
  };
}
