/**
 * Light-touch flags for the Activity Log.
 *
 * For each action in the log, ask the app's OWN scheduling logic whether the
 * thing it touched is in a questionable state RIGHT NOW, and say why:
 *
 *   tile actions   → rForce mismatch / dropped from exports / overdue in rForce
 *                    (issues.ts), double-booking (scheduling-validation.ts),
 *                    booked over PTO / Office Day / closure (availability.ts),
 *                    cancelled here but still live in rForce
 *   availability   → booked tiles that fall inside the rule's window
 *   company block  → booked tiles that fall inside the block
 *   deleted tile   → rForce still has the job scheduled
 *
 * Nothing here resolves anything and nothing is written. A flag describes the
 * current state of the thing, not what the action did, and is attached only to
 * the NEWEST action shown for that tile / rule / block — older rows about the
 * same thing would otherwise all repeat the same warning.
 *
 * Severity:
 *   red   — likely wrong in a way that costs a customer or a crew day
 *           (double-booked, cancelled here but live in rForce, dropped from rForce)
 *   amber — worth a look (mismatch, overdue in rForce, booked over time off,
 *           an edit that now collides with booked tiles)
 */

import { format } from "date-fns";
import type {
  Appointment,
  AvailabilityException,
  AvailabilityRule,
  CalendarBlock,
} from "./types";
import type { ActivityEntry } from "./activity-log";
import type { AwaitingRForceIssue, DroppedTileIssue, SchedulingIssue } from "./issues";
import { checkSchedulingConflicts, formatConflictMessage } from "./scheduling-validation";
import { checkAvailabilityConflict } from "./availability";
import { extraCrewDaysOf } from "./crew-days";

export type FlagSeverity = "red" | "amber";

export type FlagCode =
  | "double_booked"
  | "over_time_off"
  | "rforce_mismatch"
  | "rforce_dropped"
  | "rforce_overdue"
  | "cancelled_live_in_rforce"
  | "deleted_live_in_rforce"
  | "rule_hits_tiles"
  | "block_hits_tiles";

export interface ActivityFlag {
  severity: FlagSeverity;
  code: FlagCode;
  /** Plain-language "what and why". */
  message: string;
}

export const FLAG_LABELS: Record<FlagCode, string> = {
  double_booked: "Double-booked",
  over_time_off: "Booked over time off / blocked day",
  rforce_mismatch: "Doesn't match rForce",
  rforce_dropped: "Dropped from rForce exports",
  rforce_overdue: "Not in rForce yet (overdue)",
  cancelled_live_in_rforce: "Cancelled here, live in rForce",
  deleted_live_in_rforce: "Deleted here, live in rForce",
  rule_hits_tiles: "Availability change hits booked tiles",
  block_hits_tiles: "Company block hits booked tiles",
};

export interface FlagContext {
  appointments: Appointment[];
  issues: SchedulingIssue[];
  dropped: DroppedTileIssue[];
  awaiting: AwaitingRForceIssue[];
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  blocks: CalendarBlock[];
  /** yyyy-MM-dd. Tiles before this are history, not something to warn about. */
  today: string;
}

const normWo = (v: string | null | undefined) => (v || "").trim().toLowerCase();

const isLive = (a: Appointment) =>
  a.status !== "cancelled" && a.status !== "unscheduled" && a.status !== "complete";

const SEVERITY_RANK: Record<FlagSeverity, number> = { red: 2, amber: 1 };

export function worstSeverity(flags: ActivityFlag[]): FlagSeverity | null {
  let worst: FlagSeverity | null = null;
  for (const f of flags) {
    if (!worst || SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst]) worst = f.severity;
  }
  return worst;
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── Tile-level checks ───────────────────────────────────────────────────────

function tileWindow(a: Appointment): { start: string; end: string } | null {
  if (a.time_block || !a.start_time || !a.end_time) return null;
  return { start: a.start_time.slice(0, 5), end: a.end_time.slice(0, 5) };
}

/** Availability collision for one tile against a given rule/block set. */
function availabilityHit(
  a: Appointment,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
  blocks: CalendarBlock[]
) {
  if (!a.crew_id || !a.scheduled_date) return null;
  return checkAvailabilityConflict(
    a.crew_id,
    a.scheduled_date,
    a.duration_days ?? 1,
    a.time_block ?? null,
    a.time_block_end ?? null,
    rules,
    exceptions,
    blocks,
    tileWindow(a)
  );
}

function mismatchText(issue: SchedulingIssue): string {
  const d = issue.mismatchDetails;
  const parts: string[] = [];
  if (d?.date) parts.push(`date (app ${d.date.app}, rForce ${d.date.rforce})`);
  if (d?.time) parts.push(`time (app ${d.time.app}, rForce ${d.time.rforce})`);
  if (d?.crew) parts.push(`crew (app ${d.crew.app}, rForce ${d.crew.rforce})`);
  if (d?.duration) parts.push(`length (app ${d.duration.app}d, rForce ${d.duration.rforce}d)`);
  return parts.length
    ? `rForce disagrees on ${parts.join("; ")}.`
    : "rForce and this tile disagree.";
}

export function flagsForTile(a: Appointment, ctx: FlagContext): ActivityFlag[] {
  const flags: ActivityFlag[] = [];

  // rForce-side findings come from the same derivations the Issues tab renders.
  const mismatch = ctx.issues.find((i) => i.type === "mismatch" && i.appointment?.id === a.id);
  if (mismatch) {
    flags.push({ severity: "amber", code: "rforce_mismatch", message: mismatchText(mismatch) });
  }
  const dropped = ctx.dropped.find((d) => d.appointment.id === a.id);
  if (dropped) {
    flags.push({
      severity: "red",
      code: "rforce_dropped",
      message: `rForce has stopped exporting this order (${plural(dropped.missedExports, "daily export")} missed) — it may have been cancelled or moved there.`,
    });
  }
  const awaiting = ctx.awaiting.find((w) => w.appointment.id === a.id && w.tier === "overdue");
  if (awaiting) {
    flags.push({
      severity: "amber",
      code: "rforce_overdue",
      message:
        awaiting.reason === "phase_not_scheduled"
          ? `Still not scheduled in rForce after ${plural(awaiting.missedExports, "export")} — the order is on an earlier phase.`
          : `Still not in rForce after ${plural(awaiting.missedExports, "export")}.`,
    });
  }

  // App-side checks only matter while the tile is live and not already past.
  if (isLive(a) && a.crew_id && a.scheduled_date && a.scheduled_date >= ctx.today) {
    if (!a.allow_overlap) {
      const others = ctx.appointments.filter((o) => o.id === a.id || !o.allow_overlap);
      const conflicts = checkSchedulingConflicts(
        a.crew_id,
        a.scheduled_date,
        a.duration_days ?? 1,
        a.time_block ?? null,
        a.time_block_end ?? null,
        others,
        a.id,
        {
          startTime: a.start_time,
          endTime: a.end_time,
          isFullDay: a.is_full_day,
          extraCrewIds: [a.secondary_crew_id, a.tertiary_crew_id],
          extraCrewDays: extraCrewDaysOf(a),
        }
      );
      if (conflicts.length > 0) {
        const more = conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : "";
        flags.push({
          severity: "red",
          code: "double_booked",
          message: `${formatConflictMessage(conflicts[0])}${more}.`,
        });
      }
    }
    if (!a.allow_availability_conflict) {
      const hit = availabilityHit(a, ctx.rules, ctx.exceptions, ctx.blocks);
      if (hit) {
        flags.push({
          severity: "amber",
          code: "over_time_off",
          message: `Booked while the crew is ${hit.reason} on ${hit.date}${hit.fullDay ? "" : " (part of the day)"}.`,
        });
      }
    }
  }
  return flags;
}

// ── Config-level checks ─────────────────────────────────────────────────────

/** Live, upcoming tiles that fall inside a rule / block (and weren't knowingly overridden). */
function tilesHit(
  tiles: Appointment[],
  ctx: FlagContext,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
  blocks: CalendarBlock[]
): Appointment[] {
  return tiles.filter(
    (a) =>
      isLive(a) &&
      !a.allow_availability_conflict &&
      !!a.scheduled_date &&
      a.scheduled_date >= ctx.today &&
      !!availabilityHit(a, rules, exceptions, blocks)
  );
}

function flagsForRule(ruleId: string, ctx: FlagContext): ActivityFlag[] {
  const rule = ctx.rules.find((r) => r.id === ruleId);
  if (!rule || rule.is_active === false) return [];
  const exceptions = ctx.exceptions.filter((e) => e.rule_id === rule.id);
  // Ask each tile about THIS rule only, so a hit is attributable to this change.
  const hit = tilesHit(
    ctx.appointments.filter((a) => a.crew_id === rule.crew_id),
    ctx,
    [rule],
    exceptions,
    []
  );
  if (hit.length === 0) return [];
  const first = hit.map((a) => a.scheduled_date as string).sort()[0];
  return [
    {
      severity: "amber",
      code: "rule_hits_tiles",
      message: `${plural(hit.length, "booked tile")} on this crew fall inside this window (first on ${first}). They stay put — check they still make sense.`,
    },
  ];
}

function flagsForBlock(blockId: string, ctx: FlagContext): ActivityFlag[] {
  const block = ctx.blocks.find((b) => b.id === blockId);
  if (!block || block.is_active === false) return [];
  const end = block.end_date ?? block.start_date;
  const inRange = ctx.appointments.filter(
    (a) => !!a.scheduled_date && a.scheduled_date >= block.start_date && a.scheduled_date <= end
  );
  const hit = tilesHit(inRange, ctx, [], [], [block]);
  if (hit.length === 0) return [];
  return [
    {
      severity: "amber",
      code: "block_hits_tiles",
      message: `${plural(hit.length, "booked tile")} fall inside this ${block.kind === "holiday" ? "closure" : "meeting"} (first on ${hit
        .map((a) => a.scheduled_date as string)
        .sort()[0]}).`,
    },
  ];
}

// ── Entry-level driver ──────────────────────────────────────────────────────

/**
 * Flags per log entry (keyed by `entry.key`). Only the newest entry about a given
 * tile / rule / block carries flags; `entries` must be newest-first.
 */
export function flagActivity(
  entries: ActivityEntry[],
  ctx: FlagContext
): Map<string, ActivityFlag[]> {
  const out = new Map<string, ActivityFlag[]>();
  const seenSubjects = new Set<string>();

  const apptById = new Map(ctx.appointments.map((a) => [a.id, a]));
  const cancelledLive = new Map<string, SchedulingIssue>();
  const missingByWo = new Map<string, SchedulingIssue>();
  for (const i of ctx.issues) {
    if (i.type === "cancelled_locally" && i.cancelledTile) cancelledLive.set(i.cancelledTile.id, i);
    else if (i.type === "missing") missingByWo.set(normWo(i.woNumber), i);
  }

  for (const e of entries) {
    const subject = e.appointmentId
      ? `t:${e.appointmentId}`
      : e.entityId
        ? `${e.action.split("_").slice(0, 2).join("_")}:${e.entityId}`
        : null;
    if (!subject || seenSubjects.has(subject)) continue;
    seenSubjects.add(subject);

    let flags: ActivityFlag[] = [];
    if (e.appointmentId) {
      const tile = apptById.get(e.appointmentId);
      if (tile) {
        flags = flagsForTile(tile, ctx);
      } else {
        const cancelled = cancelledLive.get(e.appointmentId);
        if (cancelled) {
          flags = [
            {
              severity: "red",
              code: "cancelled_live_in_rforce",
              message: "Cancelled here, but rForce still shows the job as scheduled — cancel it there too, or restore the tile.",
            },
          ];
        }
      }
    } else if (e.action === "appointment_deleted") {
      const missing = e.workOrder ? missingByWo.get(normWo(e.workOrder)) : undefined;
      if (missing) {
        flags = [
          {
            severity: "amber",
            code: "deleted_live_in_rforce",
            message: "rForce still has this job scheduled and no tile exists now, so it shows under Issues as not on the calendar.",
          },
        ];
      }
    } else if (e.entityId && (e.action === "availability_rule_created" || e.action === "availability_rule_updated")) {
      flags = flagsForRule(e.entityId, ctx);
    } else if (e.entityId && (e.action === "calendar_block_created" || e.action === "calendar_block_updated")) {
      flags = flagsForBlock(e.entityId, ctx);
    }
    if (flags.length) out.set(e.key, flags);
  }
  return out;
}

// ── Header summary ──────────────────────────────────────────────────────────

export interface FlagSummary {
  red: number;
  amber: number;
  /** Entries carrying at least one flag. */
  flaggedEntries: number;
  byCode: Array<{ code: FlagCode; label: string; severity: FlagSeverity; count: number }>;
}

export function summarizeFlags(flags: Map<string, ActivityFlag[]>): FlagSummary {
  const counts = new Map<FlagCode, { severity: FlagSeverity; count: number }>();
  let red = 0;
  let amber = 0;
  for (const list of flags.values()) {
    const w = worstSeverity(list);
    if (w === "red") red++;
    else if (w === "amber") amber++;
    for (const f of list) {
      const c = counts.get(f.code);
      if (c) c.count++;
      else counts.set(f.code, { severity: f.severity, count: 1 });
    }
  }
  const byCode = [...counts.entries()]
    .map(([code, v]) => ({ code, label: FLAG_LABELS[code], severity: v.severity, count: v.count }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.count - a.count);
  return { red, amber, flaggedEntries: flags.size, byCode };
}

/** Today as yyyy-MM-dd in local time (the calendar's notion of "today"). */
export function localToday(now: Date = new Date()): string {
  return format(now, "yyyy-MM-dd");
}
