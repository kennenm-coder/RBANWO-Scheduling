"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Search, ShieldX, X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { canManage } from "@/lib/auth";
import {
  ACTIVITY_ACTIONS,
  EMPTY_FILTERS,
  actionLabel,
  hasActiveFilters,
  type ActivityEntry,
  type ActivityFilters,
  type ActivityTone,
} from "@/lib/activity-log";
import { ACTIVITY_PAGE_SIZE, fetchActivityActors, fetchActivityPage } from "@/lib/activity-store";
import { flagActivity, localToday, summarizeFlags, worstSeverity, type ActivityFlag, type FlagSeverity } from "@/lib/activity-flags";
import { deriveAwaitingRForce, deriveDroppedTiles, deriveIssues } from "@/lib/issues";

/**
 * Activity Log — manager and admin only.
 *
 * Every recorded action, newest first: tile changes (sched_appointment_events)
 * plus availability rules, company blocks and hard-deleted tiles
 * (sched_activity_events). Filters are applied by the database, not in the
 * browser, so a filter reaches back past the page that is on screen.
 */

const TONE_CLASS: Record<ActivityTone, string> = {
  good: "bg-green-500/15 text-green-700 dark:text-green-400",
  info: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  warn: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  bad: "bg-red-500/15 text-red-700 dark:text-red-400",
  accent: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  muted: "bg-foreground/10 text-muted",
};

const FLAG_CHIP: Record<FlagSeverity, string> = {
  red: "bg-red-500/15 text-red-700 dark:text-red-400",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

const ROW_CLASS: Record<FlagSeverity, string> = {
  red: "border-l-4 border-l-red-500 bg-red-500/5",
  amber: "border-l-4 border-l-amber-500 bg-amber-500/5",
};

const TILE_ACTIONS = Object.entries(ACTIVITY_ACTIONS).filter(([, m]) => m.source === "appointment" && m.entityType === undefined);
const OTHER_ACTIONS = Object.entries(ACTIVITY_ACTIONS).filter(([, m]) => m.source === "config");

function fmtWhen(iso: string): string {
  try {
    return format(parseISO(iso), "EEE MMM d, yyyy · h:mm a");
  } catch {
    return iso;
  }
}

export default function ActivityPage() {
  const { role, status, devBypass, user } = useAuth();
  const {
    crews,
    loading: dataLoading,
    appointments,
    rforceOrders,
    activeLinks,
    resourceMappings,
    scheduledWorkOrders,
    dismissals,
    exportDates,
    cancelledTiles,
    availabilityRules,
    availabilityExceptions,
    calendarBlocks,
  } = useData();
  const allowed = canManage(role);

  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_FILTERS);
  // The search box is typed into freely and only applied after a pause, so each
  // keystroke doesn't fire two queries.
  const [searchInput, setSearchInput] = useState("");
  const [actors, setActors] = useState<string[]>([]);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  // Bumped per query so a slow earlier response can't overwrite a newer one.
  const generation = useRef(0);

  const crewName = useCallback(
    (id: string | null) => (id ? crews.find((c) => c.id === id)?.name ?? null : null),
    [crews]
  );

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!allowed) return;
    fetchActivityActors().then(setActors).catch(() => {});
  }, [allowed]);

  // First page whenever the filters change.
  useEffect(() => {
    if (!allowed) return;
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    fetchActivityPage(filters, null, new Set())
      .then((p) => {
        if (gen !== generation.current) return;
        setEntries(p.entries);
        setCursor(p.cursor);
        setHasMore(p.hasMore);
        setConfigError(p.configError);
        setExpanded(new Set());
      })
      .catch((e) => {
        if (gen !== generation.current) return;
        setError(e instanceof Error ? e.message : "Could not load the activity log.");
        setEntries([]);
        setHasMore(false);
      })
      .finally(() => {
        if (gen === generation.current) setLoading(false);
      });
  }, [allowed, filters]);

  const loadMore = useCallback(async () => {
    const gen = generation.current;
    setLoadingMore(true);
    try {
      const p = await fetchActivityPage(filters, cursor, new Set(entries.map((e) => e.key)));
      if (gen !== generation.current) return;
      setEntries((prev) => [...prev, ...p.entries]);
      setCursor(p.cursor ?? cursor);
      // An empty page after de-duplication means the feed is exhausted.
      setHasMore(p.entries.length > 0 && p.hasMore);
    } catch (e) {
      if (gen === generation.current) setError(e instanceof Error ? e.message : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  }, [filters, cursor, entries]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const clearFilters = () => {
    setSearchInput("");
    setFilters(EMPTY_FILTERS);
  };

  const filtered = hasActiveFilters(filters);
  const selectedAction = filters.actions[0] ?? "";

  // Potential issues: the same derivations the Issues tab and nav badge use,
  // plus the calendar's own double-booking and availability checks, asked about
  // the CURRENT state of whatever each action touched. Read-only.
  const flags = useMemo(() => {
    if (!allowed) return new Map<string, ActivityFlag[]>();
    const issues = deriveIssues(rforceOrders, appointments, activeLinks, crews, resourceMappings, scheduledWorkOrders, dismissals, cancelledTiles, exportDates);
    const dropped = deriveDroppedTiles(appointments, rforceOrders, dismissals, exportDates);
    const awaiting = deriveAwaitingRForce(appointments, rforceOrders, dismissals, exportDates);
    return flagActivity(entries, {
      appointments,
      issues,
      dropped,
      awaiting,
      rules: availabilityRules,
      exceptions: availabilityExceptions,
      blocks: calendarBlocks,
      today: localToday(),
    });
  }, [allowed, entries, appointments, rforceOrders, activeLinks, crews, resourceMappings, scheduledWorkOrders, dismissals, cancelledTiles, exportDates, availabilityRules, availabilityExceptions, calendarBlocks]);

  const flagSummary = useMemo(() => summarizeFlags(flags), [flags]);
  const shown = useMemo(
    () => (onlyFlagged ? entries.filter((e) => flags.has(e.key)) : entries),
    [entries, flags, onlyFlagged]
  );

  if (status === "loading" || dataLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  // Hiding the nav link is not a gate — anyone can type the URL.
  if (!allowed) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 min-h-[60vh]">
        <div className="w-full max-w-sm text-center space-y-3">
          <ShieldX size={40} className="mx-auto text-muted" />
          <p className="font-medium">Managers only</p>
          <p className="text-sm text-muted">
            The activity log is limited to the Admin and Scheduling Manager roles.
          </p>
        </div>
      </div>
    );
  }

  const inputCls =
    "h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Activity log</h1>
          <p className="text-xs text-muted">
            Who changed what, and when — tile changes, availability and Special Ops / Office Day tiles,
            company blocks, and deleted tiles. Newest first.
          </p>
        </div>

        {/* ── Potential issues ── */}
        <div
          className={`rounded-lg border px-3 py-2.5 text-sm ${
            flagSummary.red > 0
              ? "border-red-500/40 bg-red-500/5"
              : flagSummary.amber > 0
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-border bg-background"
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <AlertTriangle
              size={15}
              className={flagSummary.red > 0 ? "text-red-500" : flagSummary.amber > 0 ? "text-amber-500" : "text-muted"}
            />
            <span className="font-medium">Potential issues</span>
            {flagSummary.flaggedEntries === 0 ? (
              <span className="text-muted">None spotted in the {entries.length} actions loaded.</span>
            ) : (
              <>
                {flagSummary.red > 0 && (
                  <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-red-500/15 text-red-700 dark:text-red-400">
                    {flagSummary.red} red
                  </span>
                )}
                {flagSummary.amber > 0 && (
                  <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400">
                    {flagSummary.amber} amber
                  </span>
                )}
                <label className="ml-auto inline-flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyFlagged}
                    onChange={(e) => setOnlyFlagged(e.target.checked)}
                  />
                  Only flagged
                </label>
              </>
            )}
          </div>
          {flagSummary.byCode.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {flagSummary.byCode.map((c) => (
                <li key={c.code} className={`rounded px-1.5 py-0.5 text-xs ${FLAG_CHIP[c.severity]}`}>
                  {c.label} · {c.count}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-muted">
            Flags show what the app&rsquo;s scheduling checks see <em>now</em> on the tile, rule or block an action
            touched, on its newest action only &mdash; not necessarily what that action caused. Based on tiles
            currently loaded on the calendar. Nothing is changed here; fix things from the{" "}
            <Link href="/issues" className="text-primary hover:underline">Issues</Link> tab or the calendar.
          </p>
        </div>

        {/* ── Filters ── */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="relative col-span-2 md:col-span-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Customer, WO# or order#"
              aria-label="Search customer or work order"
              className={`${inputCls} w-full pl-8`}
            />
          </div>
          <select
            value={selectedAction}
            onChange={(e) => setFilters((f) => ({ ...f, actions: e.target.value ? [e.target.value] : [] }))}
            aria-label="Action type"
            className={inputCls}
          >
            <option value="">All actions</option>
            <optgroup label="Tiles">
              {TILE_ACTIONS.map(([key, m]) => (
                <option key={key} value={key}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="Availability & settings">
              {OTHER_ACTIONS.map(([key, m]) => (
                <option key={key} value={key}>{m.label}</option>
              ))}
            </optgroup>
          </select>
          <select
            value={filters.actor ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value || null }))}
            aria-label="User"
            className={inputCls}
          >
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input
            type="date"
            value={filters.from ?? ""}
            max={filters.to ?? undefined}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || null }))}
            aria-label="From date"
            className={inputCls}
          />
          <input
            type="date"
            value={filters.to ?? ""}
            min={filters.from ?? undefined}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || null }))}
            aria-label="To date"
            className={inputCls}
          />
        </div>
        {filtered && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <X size={12} /> Clear filters
          </button>
        )}

        {configError && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            Availability, company-block and deleted-tile activity could not be loaded ({configError}). If the
            <code className="mx-1">20261109_002_activity_log</code>migration has not been applied yet, only tile
            changes are shown.
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* ── Feed ── */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-primary" />
          </div>
        ) : shown.length === 0 ? (
          <div className="text-center text-sm text-muted py-12 space-y-1">
            <p>{onlyFlagged && entries.length > 0 ? "No flagged actions in what is loaded." : filtered ? "Nothing matches these filters." : "No activity recorded yet."}</p>
            {devBypass && !user && (
              <p className="text-xs">
                Local dev bypass has no database session, so row-level security returns nothing. Open
                with <code>?forceLogin=1</code> and sign in to see real data.
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-background">
            {shown.map((e) => {
              const meta = ACTIVITY_ACTIONS[e.action];
              const tone = TONE_CLASS[meta?.tone ?? "muted"];
              const crew = crewName(e.crewId);
              const open = expanded.has(e.key);
              const rowFlags = flags.get(e.key) ?? [];
              const worst = worstSeverity(rowFlags);
              const subject = [e.customer, e.workOrder ? `WO ${e.workOrder}` : e.orderNumber ? `Order ${e.orderNumber}` : null]
                .filter(Boolean)
                .join(" · ");
              const detail = e.source === "config" && e.action.startsWith("availability") && crew
                ? `${crew} — ${e.summary ?? ""}`
                : e.summary;
              return (
                <li key={e.key} className={`px-3 py-2.5 ${worst ? ROW_CLASS[worst] : ""}`}>
                  <div className="flex items-start gap-2">
                    <span className={`shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
                      {actionLabel(e.action)}
                    </span>
                    <div className="flex-1 min-w-0 text-sm">
                      {subject && <div className="font-medium truncate">{subject}</div>}
                      {detail && <div className="text-muted break-words">{detail}</div>}
                      {e.reason && <div className="text-muted/80 text-xs break-words">Reason: {e.reason}</div>}
                      {rowFlags.map((f) => (
                        <div
                          key={f.code}
                          className={`mt-1 text-xs break-words ${
                            f.severity === "red" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"
                          }`}
                        >
                          <span className="font-semibold uppercase tracking-wide mr-1">{f.severity}</span>
                          {f.message}
                        </div>
                      ))}
                      <div className="text-xs text-muted/70 mt-0.5">
                        {e.actorName ?? "Unknown user"} · {fmtWhen(e.at)}
                        {e.scheduledDate && e.source === "appointment" && <> · tile on {e.scheduledDate}</>}
                      </div>
                    </div>
                    {(e.before || e.after) && (
                      <button
                        onClick={() => toggle(e.key)}
                        className="shrink-0 text-muted hover:text-foreground p-1"
                        aria-label={open ? "Hide details" : "Show details"}
                        aria-expanded={open}
                      >
                        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    )}
                  </div>
                  {open && (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {([["Before", e.before], ["After", e.after]] as const).map(([label, snap]) => (
                        <div key={label}>
                          <div className="text-[11px] uppercase tracking-wide text-muted mb-0.5">{label}</div>
                          <pre className="text-[11px] bg-foreground/5 rounded p-2 overflow-x-auto max-h-48">
                            {snap ? JSON.stringify(snap, null, 2) : "—"}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!loading && hasMore && (
          <div className="flex justify-center pb-4">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-border text-sm hover:bg-foreground/5 disabled:opacity-60"
            >
              {loadingMore && <Loader2 size={14} className="animate-spin" />}
              Load {ACTIVITY_PAGE_SIZE} more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
