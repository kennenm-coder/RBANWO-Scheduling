import { AvailabilityRule, AvailabilityException, CalendarBlock, TimeBlock, AvailabilityKind } from "./types";
import { parseISO, differenceInCalendarWeeks, format, addDays } from "date-fns";
import { MEASURE_TIME_BLOCKS, timeBlockStartEnd, getSpannedBlocks } from "./calendar-utils";

export interface CrewDayAvailability {
  available: boolean;
  workStart: string;
  workEnd: string;
  unavailableBlocks: Set<TimeBlock>;
  reason?: string;
  /**
   * The rule kind responsible for a FULL-day block (available === false).
   * Used by the calendar to pick the right visual (PTO/unavailable vs. the
   * amber Late Day / teal Office Day treatment) and to enforce precedence:
   * pto > unavailable > office_day > late_day.
   */
  blockingKind?: AvailabilityKind;
}

// Higher wins when several full-day rules land on the same day. External PTO
// (time-off requests, handled in the views) sits above all of these.
// Company-wide blocks (holiday / company_meeting) outrank every per-crew rule.
const FULL_DAY_PRIORITY: Partial<Record<AvailabilityKind, number>> = {
  holiday: 6,
  company_meeting: 5,
  pto: 4,
  unavailable: 3,
  office_day: 2,
  late_day: 1,
};

/** Does a company-wide calendar block cover this date? */
function calendarBlockCoversDate(block: CalendarBlock, dateStr: string): boolean {
  if (block.is_active === false) return false;
  const end = block.end_date || block.start_date;
  return dateStr >= block.start_date && dateStr <= end;
}

const DEFAULT_WORK_START = "08:00";
const DEFAULT_WORK_END = "18:00";

function ruleAppliesToDate(
  rule: AvailabilityRule,
  dateStr: string,
  dayOfWeek: number,
  exceptions: AvailabilityException[]
): false | { modified: false } | { modified: true; exception: AvailabilityException } {
  if (dateStr < rule.effective_start) return false;
  if (rule.effective_end && dateStr > rule.effective_end) return false;

  if (rule.weekdays.length > 0 && !rule.weekdays.includes(dayOfWeek))
    return false;

  if (rule.repeat_interval > 1 && rule.weekdays.length > 0) {
    const anchor = parseISO(rule.effective_start);
    const target = parseISO(dateStr);
    const weeksDiff = differenceInCalendarWeeks(target, anchor, {
      weekStartsOn: 0,
    });
    if (((weeksDiff % rule.repeat_interval) + rule.repeat_interval) % rule.repeat_interval !== 0)
      return false;
  }

  const exc = exceptions.find(
    (e) => e.rule_id === rule.id && e.exception_date === dateStr
  );
  if (exc) {
    if (exc.action === "skip") return false;
    return { modified: true, exception: exc };
  }

  return { modified: false };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function blockOverlapsRange(
  block: TimeBlock,
  rangeStart: string,
  rangeEnd: string
): boolean {
  const { start, end } = timeBlockStartEnd(block);
  const bs = timeToMinutes(start);
  const be = timeToMinutes(end);
  const rs = timeToMinutes(rangeStart);
  const re = timeToMinutes(rangeEnd);
  return bs < re && be > rs;
}

export function getCrewAvailability(
  crewId: string,
  date: Date,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
  companyBlocks: CalendarBlock[] = []
): CrewDayAvailability {
  const dateStr = format(date, "yyyy-MM-dd");
  const dayOfWeek = date.getDay();
  const crewRules = rules.filter((r) => r.crew_id === crewId);
  const crewExceptions = exceptions.filter((e) =>
    crewRules.some((r) => r.id === e.rule_id)
  );

  let workStart = DEFAULT_WORK_START;
  let workEnd = DEFAULT_WORK_END;
  let blockingKind: AvailabilityKind | undefined;
  let reason: string | undefined;
  const unavailableBlocks = new Set<TimeBlock>();

  // Kinds that block scheduling. Late Day / Office Day now behave like PTO /
  // Unavailable: no times → the whole day is blocked; with times → only the
  // overlapping 2-hour blocks are blocked.
  const BLOCKING_KINDS: AvailabilityKind[] = [
    "pto",
    "unavailable",
    "late_day",
    "office_day",
  ];

  function defaultReasonFor(kind: AvailabilityKind): string {
    if (kind === "pto") return "PTO";
    if (kind === "unavailable") return "Unavailable";
    return LABEL_KIND_TEXT[kind] || kind;
  }

  for (const rule of crewRules) {
    const result = ruleAppliesToDate(rule, dateStr, dayOfWeek, crewExceptions);
    if (!result) continue;

    if (BLOCKING_KINDS.includes(rule.kind)) {
      if (!rule.start_time && !rule.end_time) {
        // Full-day block — keep the highest-precedence kind so a coinciding
        // PTO wins the display over an Office Day, etc.
        const priority = FULL_DAY_PRIORITY[rule.kind] ?? 0;
        const currentPriority = blockingKind ? (FULL_DAY_PRIORITY[blockingKind] ?? 0) : -1;
        if (priority > currentPriority) {
          blockingKind = rule.kind;
          reason = rule.reason || defaultReasonFor(rule.kind);
        }
        continue;
      }
      const ruleStart =
        result.modified && result.exception.override_start_time
          ? result.exception.override_start_time
          : rule.start_time || DEFAULT_WORK_START;
      const ruleEnd =
        result.modified && result.exception.override_end_time
          ? result.exception.override_end_time
          : rule.end_time || DEFAULT_WORK_END;
      for (const block of MEASURE_TIME_BLOCKS) {
        if (blockOverlapsRange(block, ruleStart, ruleEnd)) {
          unavailableBlocks.add(block);
        }
      }
    }

    if (rule.kind === "block") {
      if (rule.start_time && rule.end_time) {
        const ruleStart =
          result.modified && result.exception.override_start_time
            ? result.exception.override_start_time
            : rule.start_time;
        const ruleEnd =
          result.modified && result.exception.override_end_time
            ? result.exception.override_end_time
            : rule.end_time;
        workStart = ruleStart;
        workEnd = ruleEnd;
        for (const block of MEASURE_TIME_BLOCKS) {
          if (!blockOverlapsRange(block, ruleStart, ruleEnd)) {
            unavailableBlocks.add(block);
          }
        }
      }
    }
  }

  // Company-wide blocks (holidays / all-office meetings). These are not scoped
  // to a crew — they apply to everyone — and sit at the top of the precedence
  // ladder. No times → whole day blocked; a time window → only the overlapping
  // 2-hour blocks (e.g. a 10-11 all-office meeting leaves the rest bookable).
  for (const block of companyBlocks) {
    if (!calendarBlockCoversDate(block, dateStr)) continue;

    if (!block.start_time && !block.end_time) {
      const priority = FULL_DAY_PRIORITY[block.kind] ?? 0;
      const currentPriority = blockingKind ? (FULL_DAY_PRIORITY[blockingKind] ?? 0) : -1;
      if (priority > currentPriority) {
        blockingKind = block.kind;
        reason = block.reason || labelForBlockingKind(block.kind);
      }
      continue;
    }

    const bs = block.start_time || DEFAULT_WORK_START;
    const be = block.end_time || DEFAULT_WORK_END;
    for (const b of MEASURE_TIME_BLOCKS) {
      if (blockOverlapsRange(b, bs, be)) unavailableBlocks.add(b);
    }
  }

  if (blockingKind) {
    MEASURE_TIME_BLOCKS.forEach((b) => unavailableBlocks.add(b));
    return { available: false, workStart, workEnd, unavailableBlocks, reason, blockingKind };
  }

  return { available: true, workStart, workEnd, unavailableBlocks, reason };
}

export function getCrewAvailabilityForWeek(
  crewId: string,
  weekStart: Date,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
  companyBlocks: CalendarBlock[] = []
): Map<string, CrewDayAvailability> {
  const result = new Map<string, CrewDayAvailability>();
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const key = format(day, "yyyy-MM-dd");
    result.set(key, getCrewAvailability(crewId, day, rules, exceptions, companyBlocks));
  }
  return result;
}

export function getAllCrewsAvailabilityForWeek(
  crewIds: string[],
  weekStart: Date,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
  companyBlocks: CalendarBlock[] = []
): Map<string, Map<string, CrewDayAvailability>> {
  const result = new Map<string, Map<string, CrewDayAvailability>>();
  for (const crewId of crewIds) {
    result.set(
      crewId,
      getCrewAvailabilityForWeek(crewId, weekStart, rules, exceptions, companyBlocks)
    );
  }
  return result;
}

export function isTimeBlockAvailable(
  availability: CrewDayAvailability,
  block: TimeBlock
): boolean {
  if (!availability.available) return false;
  return !availability.unavailableBlocks.has(block);
}

/**
 * Get the active department role assignment for a crew on a given date.
 *
 * Used for recurring role patterns like "SVC on Mon/Wed/Fri" and
 * "Measure Tech on Tue/Thu". Returns the department string (e.g.
 * "service", "measure") or null if no role_assignment rule applies.
 */
const LABEL_KINDS: AvailabilityKind[] = ["late_day", "office_day"];

export const LABEL_KIND_TEXT: Record<string, string> = {
  late_day: "Late Day",
  office_day: "Office",
};

/** Human label for whatever kind is fully blocking a day (for full-day tiles). */
export function labelForBlockingKind(kind?: AvailabilityKind): string {
  if (kind === "holiday") return "Holiday";
  if (kind === "company_meeting") return "Office Meeting";
  if (kind === "pto") return "PTO";
  if (kind === "late_day") return "Late Day";
  if (kind === "office_day") return "Office";
  return "Unavailable";
}

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Which label-only tags (Late Day / Office Day) apply to a crew on a given
 * date. These do not affect availability — they're display markers shown as
 * badges on the calendar row.
 */
export function getCrewDayLabels(
  crewId: string,
  date: Date,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[]
): AvailabilityKind[] {
  const dateStr = format(date, "yyyy-MM-dd");
  const dayOfWeek = date.getDay();
  const crewRules = rules.filter(
    (r) => r.crew_id === crewId && r.is_active && LABEL_KINDS.includes(r.kind)
  );
  const crewExceptions = exceptions.filter((e) =>
    crewRules.some((r) => r.id === e.rule_id)
  );

  const tags: AvailabilityKind[] = [];
  for (const rule of crewRules) {
    if (!ruleAppliesToDate(rule, dateStr, dayOfWeek, crewExceptions)) continue;
    if (!tags.includes(rule.kind)) tags.push(rule.kind);
  }
  return tags;
}

/**
 * Compact, date-independent summary of a crew's Late Day / Office Day rules,
 * e.g. "Office Wed, Late Day Thu". Used in the resource list summary line.
 */
export function summarizeLabelRules(
  crewId: string,
  rules: AvailabilityRule[]
): string {
  const parts: string[] = [];
  for (const kind of LABEL_KINDS) {
    const days = [
      ...new Set(
        rules
          .filter((r) => r.crew_id === crewId && r.is_active && r.kind === kind)
          .flatMap((r) => r.weekdays)
      ),
    ]
      .sort((a, b) => a - b)
      .map((d) => DAY_ABBR[d]);
    if (days.length > 0) parts.push(`${LABEL_KIND_TEXT[kind]} ${days.join("/")}`);
  }
  return parts.join(", ");
}

export function getCrewRoleForDate(
  crewId: string,
  date: Date,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[]
): string | null {
  const dateStr = format(date, "yyyy-MM-dd");
  const dayOfWeek = date.getDay();
  const crewRules = rules.filter(
    (r) => r.crew_id === crewId && r.kind === "role_assignment" && r.is_active
  );
  const crewExceptions = exceptions.filter((e) =>
    crewRules.some((r) => r.id === e.rule_id)
  );

  for (const rule of crewRules) {
    const result = ruleAppliesToDate(rule, dateStr, dayOfWeek, crewExceptions);
    if (!result) continue;
    // role_assignment rule applies — return the department
    return rule.department || null;
  }

  return null;
}

export interface AvailabilityConflictInfo {
  /** Human sentence, e.g. "out for PTO" or "on an Office day". */
  reason: string;
  /** The date the block falls on (YYYY-MM-DD). */
  date: string;
  /** True when the whole day is blocked; false when only some blocks are. */
  fullDay: boolean;
}

/**
 * Would scheduling this appointment land on a blocked availability window?
 *
 * Mirrors the double-booking pre-check: returns the first blocking window so the
 * scheduler can require an explicit override before saving over PTO, an
 * Unavailable rule, or a Late Day / Office Day block. Returns null when clear.
 */
export function checkAvailabilityConflict(
  crewId: string,
  startDate: string,
  durationDays: number,
  timeBlock: TimeBlock | null,
  timeBlockEnd: TimeBlock | null | undefined,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
  companyBlocks: CalendarBlock[] = []
): AvailabilityConflictInfo | null {
  if (!crewId || !startDate) return null;

  const occupiedBlocks: TimeBlock[] =
    timeBlock === "full_day"
      ? [...MEASURE_TIME_BLOCKS]
      : timeBlock
        ? getSpannedBlocks({ time_block: timeBlock, time_block_end: timeBlockEnd ?? null } as never)
        : [];

  const start = parseISO(startDate);
  for (let d = 0; d < Math.max(1, durationDays); d++) {
    const day = addDays(start, d);
    const dateStr = format(day, "yyyy-MM-dd");
    const avail = getCrewAvailability(crewId, day, rules, exceptions, companyBlocks);

    // Whole-day block (PTO / Unavailable / all-day Office or Late) blocks every day of the span.
    if (!avail.available) {
      return { reason: avail.reason || "unavailable", date: dateStr, fullDay: true };
    }

    // Partial windows only matter on the day the appointment actually occupies.
    if (d === 0) {
      const hit = occupiedBlocks.find((b) => avail.unavailableBlocks.has(b));
      if (hit) {
        return { reason: avail.reason || "blocked", date: dateStr, fullDay: false };
      }
    }
  }

  return null;
}
