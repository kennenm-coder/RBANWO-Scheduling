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
import { crewDayOffsets, getSpannedDates } from "./crew-days";

/**
 * Saturday or Sunday. Parsed at noon so a timezone offset can never roll the
 * date onto the previous or next day.
 */
function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day === 0 || day === 6;
}

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
  /** rForce unit count. The only load signal a legacy deal has. */
  | "product_count"
  // Helper slots. A second or third crew on a job is standing on that job all
  // day, so their utilization has to count it.
  | "secondary_crew_id"
  | "tertiary_crew_id"
  | "secondary_day_offsets"
  | "tertiary_day_offsets"
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
  /**
   * Points credited per day to an install with no material list. Default 6
   * against a 12-point day — a legacy deal reads as half a day, deliberately
   * conservative so legacy-heavy installers lean toward being flagged rather
   * than hidden. See migration 20261008_002.
   */
  legacy_points_per_day: number;
  /**
   * Points per unit when a legacy deal carries a `product_count`. 2.8 is this
   * company's measured average. Zero falls back to the per-day rate always.
   * See migration 20261009_001.
   */
  legacy_points_per_unit: number;
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
 * - `measurable`  install work, every job has a material list → real counts
 * - `estimated`   install work where at least one job is a legacy deal with no
 *                 material list → counted at the legacy per-day rate, flagged
 * - `idle`        available, nothing booked → the under-utilization signal
 * - `non_install` service / JIP / LSWP etc. → consumes the day, carries no load
 * - `off`         PTO, holiday, company meeting, unavailable → no capacity
 *
 * Legacy deals used to make the day `unmeasured` and drop it from both sides of
 * the ratio. That kept the number honest but made an installer carrying mostly
 * older work show blank instead of busy — useless on a tab for spotting who is
 * light. They are estimated now, and every estimated day is marked so an
 * estimate is never mistaken for a product count.
 */
export type DayClass = "measurable" | "estimated" | "idle" | "non_install" | "off";

/** Day classes that contribute to the utilization ratio. */
const COUNTED_CLASSES: ReadonlyArray<DayClass> = [
  "measurable",
  "estimated",
  "idle",
  "non_install",
];

export interface DayJob {
  appointmentId: string;
  orderNumber: string | null;
  workOrderNumber: string | null;
  customerName: string;
  appointmentType: AppointmentType;
  /** Lead on the job, or a helper standing on it. */
  role: CrewRole;
  /** Carries product load (an install), as opposed to service/JIP/etc. */
  loadBearing: boolean;
  /** False for an install with no material list — a "legacy deal". */
  hasTally: boolean;
  /**
   * True when a material list DOES exist but holds no countable units (all
   * misc, or no abbrev). Scored like a legacy deal, but worth telling apart:
   * the list is there and probably needs fixing, not building.
   */
  emptyTally: boolean;
  /**
   * True when `jobPoints` is an estimate rather than a real product tally. The
   * UI must never let an estimate read as a counted one.
   */
  estimated: boolean;
  /**
   * How the estimate was reached: from the job's rForce unit count, or from a
   * flat rate per day it runs. Null when nothing was estimated.
   */
  estimateBasis: "units" | "days" | null;
  /** Calendar days the job spans, including any the crew does not work. */
  spanDays: number;
  /**
   * Days of the span the crew actually works — the span minus weekends, PTO,
   * holidays. This, not `spanDays`, is what the load divides by.
   */
  workedDays: number;
  /** The whole job's points. */
  jobPoints: number;
  /** This day's share — `jobPoints / workedDays`. */
  dayPoints: number;
  /** rForce unit count on the appointment, 0 when it has none. */
  units: number;
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
  /** Days whose number is part estimate because a legacy deal landed on them. */
  estimatedDays: number;
  idleDays: number;
  nonInstallDays: number;
  offDays: number;
  /** Counted days that came in under the goal. */
  underGoalDays: number;
  /** Legacy deals — installs with no material list, so one can be built. */
  legacyJobs: DayJob[];
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
interface ScheduledJob {
  appt: UtilizationAppointment;
  /** How many days the job's load is divided across. */
  workedDays: number;
  /** Whether this crew owns the job or is helping on it. */
  role: CrewRole;
}

export type CrewRole = "lead" | "helper";

/**
 * Every (crew, date) a job occupies — for the LEAD and for any helper crews.
 *
 * Helpers were left out of v1, and on real data that was plainly wrong: a
 * second installer on a 5-day job is on that site all week, but their grid
 * read zero and went red while they were working. Utilization here is per
 * person occupancy, so the job's per-day load is credited to EVERYONE standing
 * on it rather than split between them — two people on a full day are both
 * fully occupied, not half each.
 *
 * The job's per-day rate is set by the LEAD's worked days, so a helper covering
 * 2 days of a 5-day job gets that job's normal daily intensity on their 2 days,
 * not the whole job compressed into them.
 */
function indexCrewDays(
  appointments: UtilizationAppointment[],
  isOff: (crewId: string, date: string) => string | null
): Map<string, ScheduledJob[]> {
  const byCrewDay = new Map<string, ScheduledJob[]>();

  for (const appt of appointments) {
    if (!appt.scheduled_date) continue;
    if (!COUNTED_STATUSES.includes(appt.status)) continue;

    const spanned = getSpannedDates(appt.scheduled_date, appt.duration_days);

    // A span is CALENDAR days, so a Friday-start 3-day job covers Sat and Sun.
    // Dividing by the raw span and then zeroing the off days threw that work
    // away: 36 points over Fri/Sat/Sun scored 12, and the installer read as a
    // third as busy as they were. Divide by the days actually worked.
    const leadId = appt.crew_id;
    const leadWorked = leadId ? spanned.filter((d) => !isOff(leadId, d)) : spanned;
    const divisor = Math.max(1, leadWorked.length || spanned.length);

    const slots: Array<{ id: string | null; role: CrewRole }> = [
      { id: appt.crew_id, role: "lead" },
      { id: appt.secondary_crew_id ?? null, role: "helper" },
      { id: appt.tertiary_crew_id ?? null, role: "helper" },
    ];

    const seen = new Set<string>();
    for (const slot of slots) {
      if (!slot.id || seen.has(slot.id)) continue;
      seen.add(slot.id);

      // Honour partial helper days: a helper marked for days 2-3 of a span is
      // only on site for those.
      const offsets = crewDayOffsets(appt, slot.id);
      const crewDates = offsets
        ? offsets.map((i) => spanned[i]).filter(Boolean)
        : spanned;

      const worked = crewDates.filter((d) => !isOff(slot.id!, d));
      // Every day blocked and the job booked anyway (the scheduler can override
      // availability) — the work still happened, so keep the crew's own dates.
      const effective = worked.length > 0 ? worked : crewDates;

      for (const date of effective) {
        const key = `${slot.id}|${date}`;
        const entry: ScheduledJob = { appt, workedDays: divisor, role: slot.role };
        const list = byCrewDay.get(key);
        if (list) list.push(entry);
        else byCrewDay.set(key, [entry]);
      }
    }
  }
  return byCrewDay;
}

function buildDayJob(
  { appt, workedDays, role }: ScheduledJob,
  tallyByOrder: Map<string, InstallTally>,
  weights: WeightMap,
  legacyPointsPerDay: number,
  legacyPointsPerUnit: number
): DayJob {
  const loadBearing = LOAD_BEARING_TYPES.includes(appt.appointment_type);
  const order = appt.order_number?.trim() || "";
  const found = order ? tallyByOrder.get(order) : undefined;
  // A tally that sums to zero is a material list with nothing countable on it
  // — every unit is misc, or none carries an abbrev. That is not a confident
  // "no work"; it is the same absence of information as having no list, so it
  // is treated as one rather than reading as a silent idle day.
  const tally = found && found.total_units > 0 ? found : undefined;
  const spanDays = Math.max(1, appt.duration_days || 1);
  const divisor = Math.max(1, workedDays);
  const breakdown = tally ? tallyBreakdown(tally, weights) : [];
  // A load-bearing job with no material list is a legacy deal: estimated at the
  // legacy rate for every day it RUNS (so a 3-day job is worth 3x a 1-day one),
  // then divided over the days actually worked like any other job.
  const estimated = loadBearing && !tally;
  // Prefer the unit count when the job has one. A flat per-day rate counted a
  // real 92-unit job as roughly an eighth of its weight; rForce's own unit
  // count gets far closer, even without knowing the frame mix.
  const units = Number(appt.product_count) || 0;
  const useUnits = estimated && units > 0 && legacyPointsPerUnit > 0;
  const estimateBasis: DayJob["estimateBasis"] = !estimated
    ? null
    : useUnits
      ? "units"
      : "days";
  const jobPoints = tally
    ? tallyPoints(tally, weights)
    : useUnits
      ? units * legacyPointsPerUnit
      : estimated
        ? legacyPointsPerDay * spanDays
        : 0;
  return {
    appointmentId: appt.id,
    orderNumber: appt.order_number,
    workOrderNumber: appt.work_order_number,
    customerName: appt.customer_name,
    appointmentType: appt.appointment_type,
    loadBearing,
    role,
    // Only load-bearing work NEEDS a tally; a service call is not "missing" one.
    hasTally: loadBearing ? !!tally : true,
    emptyTally: loadBearing && !!found && !tally,
    estimated,
    estimateBasis,
    units,
    spanDays,
    workedDays: divisor,
    jobPoints,
    dayPoints: jobPoints / divisor,
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
  const installJobs = jobs.filter((j) => j.loadBearing);

  // An EMPTY weekend is not idle capacity, it is a day nobody was expected to
  // work. Only some crews carry an availability rule covering weekends, so
  // without this the ones that don't were charged a full 12-point Saturday and
  // Sunday every week -- about 96 phantom points per four-week range. That is
  // what put most of the grid in the red and kept anyone from reaching goal.
  //
  // A weekend day WITH work booked still counts: they worked it, so it belongs
  // in both halves of the ratio.
  if (jobs.length === 0 && isWeekend(date)) {
    return {
      crewId,
      date,
      dayClass: "off",
      points: 0,
      capacity: 0,
      jobs,
      offReason: offReason || "Weekend",
    };
  }

  // An off day with install work on it is not an off day. The scheduler can
  // deliberately book over a blocked window (allow_availability_conflict), and
  // when they have, the work is real and has to be counted — otherwise its
  // points vanish and the installer looks idle on a day they were on site.
  if (offReason && installJobs.length === 0) {
    return { crewId, date, dayClass: "off", points: 0, capacity: 0, jobs, offReason };
  }

  if (installJobs.length > 0) {
    const points = installJobs.reduce((sum, j) => sum + j.dayPoints, 0);
    // One legacy deal is enough to mark the whole day estimated — the number
    // shown is then part guess, and the UI has to say so.
    const dayClass: DayClass = installJobs.some((j) => j.estimated)
      ? "estimated"
      : "measurable";
    return { crewId, date, dayClass, points, capacity: target, jobs };
  }

  if (jobs.length > 0) {
    return { crewId, date, dayClass: "non_install", points: 0, capacity: target, jobs };
  }

  return { crewId, date, dayClass: "idle", points: 0, capacity: target, jobs };
}

/** Build one row per installer: the day grid plus its range rollup. */
export function computeUtilization(input: UtilizationInput): CrewUtilization[] {
  const { crews, dates, appointments, tallyByOrder, weights, settings, targets, isOff } = input;
  const byCrewDay = indexCrewDays(appointments, isOff);
  const goalFraction = settings.goal_utilization_pct / 100;
  const legacyRate = Number.isFinite(settings.legacy_points_per_day)
    ? Math.max(0, settings.legacy_points_per_day)
    : 6;
  const legacyUnitRate = Number.isFinite(settings.legacy_points_per_unit)
    ? Math.max(0, settings.legacy_points_per_unit)
    : 2.8;

  const rows: CrewUtilization[] = [];

  for (const crew of crews) {
    const target = targetFor(crew.id, targets, settings);
    const days: CrewDay[] = [];

    for (const date of dates) {
      const scheduled = byCrewDay.get(`${crew.id}|${date}`) || [];
      const jobs = scheduled.map((s) =>
        buildDayJob(s, tallyByOrder, weights, legacyRate, legacyUnitRate)
      );
      days.push(classifyDay(crew.id, date, jobs, target, isOff(crew.id, date)));
    }

    let totalPoints = 0;
    let capacity = 0;
    let measurableDays = 0;
    let estimatedDays = 0;
    let idleDays = 0;
    let nonInstallDays = 0;
    let offDays = 0;
    let underGoalDays = 0;
    const legacyJobs: DayJob[] = [];
    const seenLegacy = new Set<string>();

    for (const day of days) {
      totalPoints += day.points;
      capacity += day.capacity;

      if (day.dayClass === "measurable") measurableDays++;
      else if (day.dayClass === "estimated") estimatedDays++;
      else if (day.dayClass === "idle") idleDays++;
      else if (day.dayClass === "non_install") nonInstallDays++;
      else if (day.dayClass === "off") offDays++;

      if (COUNTED_CLASSES.includes(day.dayClass) && day.capacity > 0) {
        if (day.points / day.capacity < goalFraction) underGoalDays++;
      }

      for (const job of day.jobs) {
        // One entry per job, not per day it spans.
        if (!job.hasTally && !seenLegacy.has(job.appointmentId)) {
          seenLegacy.add(job.appointmentId);
          legacyJobs.push(job);
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
      estimatedDays,
      idleDays,
      nonInstallDays,
      offDays,
      underGoalDays,
      legacyJobs,
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
  /** Distinct install jobs in range scored from a real material list. */
  measuredJobs: number;
  /** Distinct legacy deals in range — scored at the legacy rate, not counted. */
  legacyJobs: number;
  /** Days whose number is part estimate. */
  estimatedDays: number;
}

/** The honesty line for the top of the page. */
export function summarizeCoverage(rows: CrewUtilization[]): CoverageSummary {
  const measured = new Set<string>();
  const legacy = new Set<string>();
  let estimatedDays = 0;

  for (const row of rows) {
    estimatedDays += row.estimatedDays;
    for (const day of row.days) {
      for (const job of day.jobs) {
        if (!job.loadBearing) continue;
        if (job.hasTally) measured.add(job.appointmentId);
        else legacy.add(job.appointmentId);
      }
    }
  }

  return {
    measuredJobs: measured.size,
    legacyJobs: legacy.size,
    estimatedDays,
  };
}

/**
 * The hover text for one day cell: every job, its product mix and what it
 * contributed. Built here rather than in the grid so the arithmetic shown to
 * the user comes from the same place that computed it.
 */
export function describeDayPoints(day: CrewDay): string {
  if (day.dayClass === "off") return day.offReason || "Off";

  const NL = "\n";
  const INDENT = NL + "    ";
  const lines: string[] = [];

  for (const job of day.jobs) {
    const span =
      job.spanDays > 1
        ? ` (${formatPoints(job.jobPoints)} over ${job.workedDays}d)`
        : "";

    if (!job.loadBearing) {
      lines.push(
        `${job.customerName} — ${job.appointmentType.replace(/_/g, " ")}, no product load`
      );
    } else if (job.estimated) {
      // Never show a product mix here — there isn't one, and an estimate must
      // not be able to read as a count of real units.
      lines.push(
        `${job.customerName} — ${job.emptyTally ? "LIST HAS NO COUNTABLE UNITS" : "LEGACY DEAL, no material list"}` +
          INDENT +
          `estimated ${formatPoints(job.dayPoints)} pts${span}` +
          INDENT +
          (job.estimateBasis === "units"
            ? `from ${job.units} rForce units (no frame mix known)`
            : "from days scheduled — no unit count on this job")
      );
    } else {
      const mix = job.breakdown
        .map((b) => `${b.count} ${b.short} = ${formatPoints(b.points)}`)
        .join(", ");
      lines.push(
        `${job.customerName} — ${formatPoints(job.dayPoints)} pts${span}` +
          (mix ? INDENT + mix : "")
      );
    }
  }

  if (lines.length === 0) return "Nothing booked";

  const pct =
    day.capacity > 0 ? ` (${Math.round((day.points / day.capacity) * 100)}%)` : "";
  const total = `Total ${formatPoints(day.points)} of ${formatPoints(day.capacity)} pts${pct}`;
  const caveat =
    day.dayClass === "estimated" ? NL + "Includes estimated legacy deals" : "";

  return lines.join(NL) + NL + total + caveat;
}
