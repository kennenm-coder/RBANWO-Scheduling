/**
 * Pure logic for the manager-only Activity Log (/activity).
 *
 * Two sources feed one newest-first list:
 *   - sched_appointment_events : everything that happens to a tile
 *   - sched_activity_events    : changes that are NOT tied to a live tile —
 *                                availability rules (incl. Special Ops / Office
 *                                Day tiles), company-wide blocks, and hard
 *                                deletes of an appointment (a snapshot, because
 *                                the appointment's own events cascade away)
 *
 * Nothing here touches the database; activity-store.ts does the queries and
 * hands rows to these functions.
 */

import type { AppointmentEvent } from "./types";

// ── Unified entry ───────────────────────────────────────────────────────────

export type ActivitySource = "appointment" | "config";

export interface ActivityEntry {
  /** Prefixed with the source so ids from the two tables can never collide. */
  key: string;
  source: ActivitySource;
  /** Unified action key — see ACTIVITY_ACTIONS. */
  action: string;
  at: string; // ISO timestamp
  actorId: string | null;
  actorName: string | null;
  /** What the change was about, in one line. */
  summary: string | null;
  reason: string | null;
  // Appointment context (null for config entries)
  appointmentId: string | null;
  customer: string | null;
  workOrder: string | null;
  orderNumber: string | null;
  scheduledDate: string | null;
  /** Crew an availability rule / appointment snapshot refers to (resolve to a name in the UI). */
  crewId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

// ── Action catalogue ────────────────────────────────────────────────────────

export type ActivityTone = "good" | "info" | "warn" | "bad" | "muted" | "accent";

export interface ActionMeta {
  label: string;
  tone: ActivityTone;
  source: ActivitySource;
  /** Underlying DB action value (for the source table's `action` filter). */
  dbAction: string;
  /** For config entries, the entity_type the DB row carries. */
  entityType?: string;
}

export const ACTIVITY_ACTIONS: Record<string, ActionMeta> = {
  // sched_appointment_events
  created: { label: "Created", tone: "good", source: "appointment", dbAction: "created" },
  updated: { label: "Edited", tone: "info", source: "appointment", dbAction: "updated" },
  rescheduled: { label: "Rescheduled", tone: "warn", source: "appointment", dbAction: "rescheduled" },
  drag_moved: { label: "Moved", tone: "warn", source: "appointment", dbAction: "drag_moved" },
  drag_resized: { label: "Resized", tone: "warn", source: "appointment", dbAction: "drag_resized" },
  approved_from_rforce: { label: "Approved from rForce", tone: "good", source: "appointment", dbAction: "approved_from_rforce" },
  cancelled: { label: "Cancelled", tone: "bad", source: "appointment", dbAction: "cancelled" },
  restored: { label: "Restored", tone: "good", source: "appointment", dbAction: "restored" },
  unscheduled: { label: "Sent to queue", tone: "warn", source: "appointment", dbAction: "unscheduled" },
  merged: { label: "Merged", tone: "accent", source: "appointment", dbAction: "merged" },
  helper_added: { label: "Helper added", tone: "info", source: "appointment", dbAction: "helper_added" },
  helper_removed: { label: "Helper removed", tone: "muted", source: "appointment", dbAction: "helper_removed" },
  linked: { label: "Linked to rForce", tone: "accent", source: "appointment", dbAction: "linked" },
  flagged: { label: "Flagged", tone: "warn", source: "appointment", dbAction: "flagged" },
  sync_state_changed: { label: "Sync state changed", tone: "muted", source: "appointment", dbAction: "sync_state_changed" },
  // sched_activity_events
  appointment_deleted: { label: "Tile deleted", tone: "bad", source: "config", dbAction: "deleted", entityType: "appointment" },
  availability_rule_created: { label: "Availability added", tone: "good", source: "config", dbAction: "created", entityType: "availability_rule" },
  availability_rule_updated: { label: "Availability edited", tone: "info", source: "config", dbAction: "updated", entityType: "availability_rule" },
  availability_rule_deleted: { label: "Availability removed", tone: "bad", source: "config", dbAction: "deleted", entityType: "availability_rule" },
  calendar_block_created: { label: "Company block added", tone: "good", source: "config", dbAction: "created", entityType: "calendar_block" },
  calendar_block_updated: { label: "Company block edited", tone: "info", source: "config", dbAction: "updated", entityType: "calendar_block" },
  calendar_block_deleted: { label: "Company block removed", tone: "bad", source: "config", dbAction: "deleted", entityType: "calendar_block" },
};

export function actionLabel(action: string): string {
  return ACTIVITY_ACTIONS[action]?.label ?? action.replace(/_/g, " ");
}

/** Unified key for a config row. Unknown combinations still get a stable key. */
export function configActionKey(entityType: string, dbAction: string): string {
  if (entityType === "appointment" && dbAction === "deleted") return "appointment_deleted";
  return `${entityType}_${dbAction}`;
}

/** Which source tables can possibly hold a row for these selected action keys. */
export function sourcesForActions(actions: string[]): { appointment: boolean; config: boolean } {
  if (actions.length === 0) return { appointment: true, config: true };
  let appointment = false;
  let config = false;
  for (const a of actions) {
    const meta = ACTIVITY_ACTIONS[a];
    if (!meta) continue;
    if (meta.source === "appointment") appointment = true;
    else config = true;
  }
  return { appointment, config };
}

/** DB `action` values to send in an `in (...)` filter for the appointment table. */
export function appointmentDbActions(actions: string[]): string[] {
  return actions
    .map((a) => ACTIVITY_ACTIONS[a])
    .filter((m): m is ActionMeta => !!m && m.source === "appointment")
    .map((m) => m.dbAction);
}

/** Filter pairs for the config table: [entity_type, db action] per selected key. */
export function configActionPairs(actions: string[]): Array<{ entityType: string; dbAction: string }> {
  return actions
    .map((a) => ACTIVITY_ACTIONS[a])
    .filter((m): m is ActionMeta => !!m && m.source === "config" && !!m.entityType)
    .map((m) => ({ entityType: m.entityType as string, dbAction: m.dbAction }));
}

// ── Normalising rows ────────────────────────────────────────────────────────

export interface AppointmentEventRow extends AppointmentEvent {
  /** PostgREST embed of the parent appointment. May be an array or null. */
  appointment?: AppointmentSnapshot | AppointmentSnapshot[] | null;
}

export interface AppointmentSnapshot {
  customer_name: string | null;
  work_order_number: string | null;
  order_number: string | null;
  scheduled_date: string | null;
  crew_id: string | null;
}

export interface ConfigEventRow {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  actor_id: string | null;
  actor_name_snapshot: string | null;
  summary: string | null;
  reason: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function normalizeAppointmentEvent(row: AppointmentEventRow): ActivityEntry {
  const appt = one(row.appointment);
  return {
    key: `a:${row.id}`,
    source: "appointment",
    action: row.action,
    at: row.created_at,
    actorId: row.actor_id,
    actorName: row.actor_name_snapshot,
    summary: describeAppointmentChange(row.action, row.before_state, row.after_state),
    reason: row.reason,
    appointmentId: row.appointment_id,
    customer: appt?.customer_name ?? null,
    workOrder: appt?.work_order_number ?? null,
    orderNumber: appt?.order_number ?? null,
    scheduledDate: appt?.scheduled_date ?? null,
    crewId: appt?.crew_id ?? null,
    before: row.before_state,
    after: row.after_state,
  };
}

export function normalizeConfigEvent(row: ConfigEventRow): ActivityEntry {
  const snap = (row.after_state ?? row.before_state ?? {}) as Record<string, unknown>;
  const isAppt = row.entity_type === "appointment";
  return {
    key: `c:${row.id}`,
    source: "config",
    action: configActionKey(row.entity_type, row.action),
    at: row.created_at,
    actorId: row.actor_id,
    actorName: row.actor_name_snapshot,
    summary: row.summary,
    reason: row.reason,
    appointmentId: null,
    customer: isAppt ? str(snap.customer_name) : null,
    workOrder: isAppt ? str(snap.work_order_number) : null,
    orderNumber: isAppt ? str(snap.order_number) : null,
    scheduledDate: isAppt ? str(snap.scheduled_date) : null,
    crewId: str(snap.crew_id),
    before: row.before_state,
    after: row.after_state,
  };
}

// ── Describing changes ──────────────────────────────────────────────────────

/** Fields worth surfacing in a one-line before → after for a tile change. */
const DIFF_FIELDS: Array<{ key: string; label: string }> = [
  { key: "scheduled_date", label: "date" },
  { key: "time_block", label: "block" },
  { key: "start_time", label: "start" },
  { key: "end_time", label: "end" },
  { key: "appointment_type", label: "type" },
  { key: "status", label: "status" },
  { key: "sync_state", label: "sync" },
];

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

/**
 * "date 2026-11-10 → 2026-11-12, block 9-10 → 10-11" from an event's before /
 * after snapshots. Returns null when nothing recognisable differs (the History
 * panel's reason text and the raw snapshots still carry the detail).
 */
export function describeAppointmentChange(
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string | null {
  if (!before && !after) return null;
  const b = before ?? {};
  const a = after ?? {};
  const parts: string[] = [];
  for (const { key, label } of DIFF_FIELDS) {
    const hasB = key in b;
    const hasA = key in a;
    if (!hasB && !hasA) continue;
    if (hasB && hasA && show(b[key]) === show(a[key])) continue;
    if (!hasB) {
      // Creation-style event: only an after snapshot — show the landing value.
      if (action === "created" || action === "approved_from_rforce") parts.push(`${label} ${show(a[key])}`);
      continue;
    }
    parts.push(`${label} ${show(b[key])} → ${show(a[key])}`);
  }
  return parts.length ? parts.join(", ") : null;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const RULE_KIND_LABELS: Record<string, string> = {
  pto: "PTO",
  unavailable: "Unavailable",
  role_assignment: "Role assignment",
  block: "Block",
  late_day: "Late Day",
  office_day: "Office Day",
};

export interface RuleLike {
  kind?: string | null;
  weekdays?: number[] | null;
  effective_start?: string | null;
  effective_end?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  department?: string | null;
  repeat_interval?: number | null;
  reason?: string | null;
}

/**
 * One-line description of an availability rule, WITHOUT the crew name (the
 * writer doesn't have it; the viewer resolves crew_id).
 *   "Office Day · Mon, Wed · 2026-11-10 → 2026-12-01"
 *   "Office Day · 2026-11-10"            (one-day Special Ops / Office Day tile)
 */
export function describeRule(rule: RuleLike): string {
  const kind = RULE_KIND_LABELS[rule.kind ?? ""] ?? (rule.kind ? String(rule.kind) : "Rule");
  const parts: string[] = [kind];
  if (rule.department) parts[0] = `${kind} (${rule.department})`;
  const start = rule.effective_start ?? null;
  const end = rule.effective_end ?? null;
  const oneDay = !!start && !!end && start === end;
  if (!oneDay && rule.weekdays && rule.weekdays.length > 0 && rule.weekdays.length < 7) {
    const names = [...rule.weekdays].sort((x, y) => x - y).map((d) => WEEKDAY_NAMES[d] ?? String(d));
    const every = rule.repeat_interval && rule.repeat_interval > 1 ? `every ${rule.repeat_interval} wks ` : "";
    parts.push(`${every}${names.join(", ")}`);
  }
  if (oneDay) parts.push(start as string);
  else if (start && end) parts.push(`${start} → ${end}`);
  else if (start) parts.push(`from ${start}`);
  if (rule.start_time && rule.end_time) {
    parts.push(`${rule.start_time.slice(0, 5)}–${rule.end_time.slice(0, 5)}`);
  }
  if (rule.reason) parts.push(`“${rule.reason}”`);
  return parts.join(" · ");
}

export interface BlockLike {
  kind?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  reason?: string | null;
}

/** "Holiday · 2026-12-24 → 2026-12-26 · “Christmas”" */
export function describeBlock(block: BlockLike): string {
  const kind = block.kind === "holiday" ? "Holiday" : block.kind === "company_meeting" ? "Office meeting" : "Company block";
  const parts: string[] = [kind];
  const s = block.start_date ?? null;
  const e = block.end_date ?? null;
  if (s && e && e !== s) parts.push(`${s} → ${e}`);
  else if (s) parts.push(s);
  if (block.start_time && block.end_time) parts.push(`${block.start_time.slice(0, 5)}–${block.end_time.slice(0, 5)}`);
  if (block.reason) parts.push(`“${block.reason}”`);
  return parts.join(" · ");
}

/** What a hard-deleted tile looked like. */
export function describeDeletedAppointment(a: {
  customer_name?: string | null;
  work_order_number?: string | null;
  appointment_type?: string | null;
  scheduled_date?: string | null;
  status?: string | null;
}): string {
  const parts: string[] = [];
  if (a.customer_name) parts.push(a.customer_name);
  if (a.work_order_number) parts.push(`WO ${a.work_order_number}`);
  if (a.appointment_type) parts.push(a.appointment_type);
  if (a.scheduled_date) parts.push(a.scheduled_date);
  if (a.status) parts.push(`(was ${a.status})`);
  return parts.length ? parts.join(" · ") : "Tile deleted";
}

// ── Merging two newest-first feeds ──────────────────────────────────────────

/** Newest first; ties broken by key so the order is stable across fetches. */
export function compareEntries(a: ActivityEntry, b: ActivityEntry): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

/**
 * Merge entries from both sources into one newest-first page.
 *
 * `known` holds keys already shown, so a "load more" that re-fetches the
 * boundary timestamp (cursor is inclusive — see activity-store.ts) never
 * duplicates a row. `hasMore` is true when either source filled its page, i.e.
 * more may exist beyond what we took.
 */
export function mergeFeeds(
  feeds: ActivityEntry[][],
  pageSize: number,
  known: ReadonlySet<string> = new Set()
): { entries: ActivityEntry[]; cursor: string | null; hasMore: boolean } {
  const seen = new Set<string>();
  const all: ActivityEntry[] = [];
  let anyFull = false;
  for (const feed of feeds) {
    if (feed.length >= pageSize) anyFull = true;
    for (const e of feed) {
      if (known.has(e.key) || seen.has(e.key)) continue;
      seen.add(e.key);
      all.push(e);
    }
  }
  all.sort(compareEntries);
  const entries = all.slice(0, pageSize);
  const cutOff = all.length > pageSize;
  const last = entries[entries.length - 1];
  return {
    entries,
    cursor: last ? last.at : null,
    hasMore: cutOff || anyFull,
  };
}

// ── Filters ─────────────────────────────────────────────────────────────────

export interface ActivityFilters {
  actions: string[]; // unified action keys; [] = all
  actor: string | null; // actor_name_snapshot; null = everyone
  from: string | null; // yyyy-MM-dd, local day, inclusive
  to: string | null; // yyyy-MM-dd, local day, inclusive
  search: string; // customer / WO# / order#
}

export const EMPTY_FILTERS: ActivityFilters = { actions: [], actor: null, from: null, to: null, search: "" };

export function hasActiveFilters(f: ActivityFilters): boolean {
  return f.actions.length > 0 || !!f.actor || !!f.from || !!f.to || f.search.trim() !== "";
}

/**
 * Local-day range → ISO instants [gte, lt). `to` is inclusive, so the upper
 * bound is the start of the following local day. Invalid / empty dates → null.
 */
export function dayRangeToIso(
  from: string | null,
  to: string | null
): { gte: string | null; lt: string | null } {
  const start = from ? localDayStart(from) : null;
  let end: Date | null = null;
  if (to) {
    const d = localDayStart(to);
    if (d) {
      d.setDate(d.getDate() + 1);
      end = d;
    }
  }
  return { gte: start ? start.toISOString() : null, lt: end ? end.toISOString() : null };
}

function localDayStart(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Make free text safe inside a PostgREST `or(...)` / ilike pattern: strip the
 * characters that have structural meaning there (commas, parens, wildcards,
 * quotes, backslashes) instead of trying to escape them.
 */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()*%_\\"']/g, " ").replace(/\s+/g, " ").trim();
}

/** Distinct actor names, most frequent first (a stable, useful dropdown order). */
export function distinctActors(rows: Array<{ actor_name_snapshot: string | null }>): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const n = r.actor_name_snapshot?.trim();
    if (!n) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([n]) => n);
}
