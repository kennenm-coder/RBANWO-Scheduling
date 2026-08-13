import { AvailabilityRule, AvailabilityException, TimeBlock } from "./types";
import { parseISO, differenceInCalendarWeeks, format, addDays } from "date-fns";
import { MEASURE_TIME_BLOCKS, timeBlockStartEnd } from "./calendar-utils";

export interface CrewDayAvailability {
  available: boolean;
  workStart: string;
  workEnd: string;
  unavailableBlocks: Set<TimeBlock>;
  reason?: string;
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
  exceptions: AvailabilityException[]
): CrewDayAvailability {
  const dateStr = format(date, "yyyy-MM-dd");
  const dayOfWeek = date.getDay();
  const crewRules = rules.filter((r) => r.crew_id === crewId);
  const crewExceptions = exceptions.filter((e) =>
    crewRules.some((r) => r.id === e.rule_id)
  );

  let workStart = DEFAULT_WORK_START;
  let workEnd = DEFAULT_WORK_END;
  let fullyUnavailable = false;
  let reason: string | undefined;
  const unavailableBlocks = new Set<TimeBlock>();

  for (const rule of crewRules) {
    const result = ruleAppliesToDate(rule, dateStr, dayOfWeek, crewExceptions);
    if (!result) continue;

    if (rule.kind === "unavailable" || rule.kind === "pto") {
      if (!rule.start_time && !rule.end_time) {
        fullyUnavailable = true;
        reason = rule.reason || (rule.kind === "pto" ? "PTO" : "Unavailable");
        break;
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

  if (fullyUnavailable) {
    MEASURE_TIME_BLOCKS.forEach((b) => unavailableBlocks.add(b));
    return { available: false, workStart, workEnd, unavailableBlocks, reason };
  }

  return { available: true, workStart, workEnd, unavailableBlocks, reason };
}

export function getCrewAvailabilityForWeek(
  crewId: string,
  weekStart: Date,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[]
): Map<string, CrewDayAvailability> {
  const result = new Map<string, CrewDayAvailability>();
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const key = format(day, "yyyy-MM-dd");
    result.set(key, getCrewAvailability(crewId, day, rules, exceptions));
  }
  return result;
}

export function getAllCrewsAvailabilityForWeek(
  crewIds: string[],
  weekStart: Date,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[]
): Map<string, Map<string, CrewDayAvailability>> {
  const result = new Map<string, Map<string, CrewDayAvailability>>();
  for (const crewId of crewIds) {
    result.set(
      crewId,
      getCrewAvailabilityForWeek(crewId, weekStart, rules, exceptions)
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
