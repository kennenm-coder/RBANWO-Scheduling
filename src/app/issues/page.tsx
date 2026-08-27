"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/components/DataProvider";
import { fetchScheduledWorkOrderNumbers } from "@/lib/store";
import { deriveIssues, deriveDroppedTiles, type SchedulingIssue, type DroppedTileIssue } from "@/lib/issues";
import { Loader2, AlertTriangle, ArrowRightLeft, Search, MapPin, CheckCheck, X, Ban, Check, ExternalLink } from "lucide-react";
import { format, parseISO } from "date-fns";

/**
 * Human-facing issue buckets (mutually exclusive, so the counts sum to All):
 *  - not_scheduled  : rForce says scheduled but there's no calendar tile yet.
 *  - schedule_differs: a tile exists but its day, time, or crew disagree.
 *  - under_scheduled: a multi-day job booked for fewer days (duration only).
 *  - review_cancellation: a tile whose rForce order silently dropped from imports.
 */
type IssueCategory = "not_scheduled" | "schedule_differs" | "under_scheduled" | "review_cancellation";

function issueCategory(i: SchedulingIssue): IssueCategory {
  if (i.type === "missing") return "not_scheduled";
  const d = i.mismatchDetails;
  if (d && (d.date || d.time || d.crew)) return "schedule_differs";
  if (d && d.duration) return "under_scheduled";
  return "schedule_differs";
}

const CATEGORY_META: Record<IssueCategory, { label: string; desc: string }> = {
  not_scheduled: {
    label: "Not on calendar",
    desc: "rForce shows these scheduled, but no tile exists yet — approve or place them.",
  },
  schedule_differs: {
    label: "Schedule differs",
    desc: "A tile exists but its day, time, or crew doesn't match rForce.",
  },
  under_scheduled: {
    label: "Under-scheduled",
    desc: "The job spans more days in rForce than are booked on the calendar.",
  },
  review_cancellation: {
    label: "Dropped from rForce",
    desc: "A scheduled tile whose rForce order stopped appearing in imports — likely cancelled or rescheduled. Review it.",
  },
};

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "MMM d, yyyy");
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string | undefined): string {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function parseCity(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((p) => p.trim());
  return parts.length >= 3 ? parts[parts.length - 2] : parts[0] || "";
}

function IssueRow({
  issue,
  onClick,
  onDismiss,
  dismissing,
}: {
  issue: SchedulingIssue;
  onClick: () => void;
  onDismiss?: () => void;
  dismissing?: boolean;
}) {
  const city = parseCity(issue.address);
  const canDismiss = issue.type === "missing" && !!onDismiss;

  return (
    <div className="relative border-b border-border hover:bg-muted/10 transition-colors">
      <button
        onClick={onClick}
        className={`w-full text-left px-4 py-3 ${canDismiss ? "pb-10" : ""}`}
      >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-xs text-muted">{issue.woNumber}</span>
            {(() => {
              const cat = issueCategory(issue);
              const style: Record<IssueCategory, string> = {
                not_scheduled: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
                schedule_differs: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                under_scheduled: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                review_cancellation: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
              };
              return (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${style[cat]}`}>
                  {CATEGORY_META[cat].label}
                </span>
              );
            })()}
          </div>
          <div className="font-medium text-sm truncate">{issue.customerName}</div>
          {city && (
            <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
              <MapPin size={10} />
              <span className="truncate">{city}</span>
            </div>
          )}
        </div>
        <div className="text-right text-xs shrink-0">
          {issue.type === "missing" ? (
            <div>
              <div className="text-muted text-[10px]">rForce</div>
              <div>{formatDate(issue.rforceDate)}</div>
              {issue.rforceTime && (
                <div className="text-muted">{formatTime(issue.rforceTime)}</div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div>
                <div className="text-muted text-[10px]">rForce</div>
                <div>{formatDate(issue.rforceDate)}</div>
                {issue.mismatchDetails?.time && (
                  <div className="text-muted">{formatTime(issue.rforceTime)}</div>
                )}
              </div>
              <ArrowRightLeft size={12} className="text-muted shrink-0" />
              <div>
                <div className="text-muted text-[10px]">App</div>
                <div>{formatDate(issue.appDate)}</div>
                {issue.mismatchDetails?.time && (
                  <div className="text-muted">{formatTime(issue.appTime)}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {issue.mismatchDetails?.crew && (
        <div className="text-[10px] text-muted mt-1">
          Crew: {issue.mismatchDetails.crew.rforce} (rForce) → {issue.mismatchDetails.crew.app} (App)
        </div>
      )}
      {issue.mismatchDetails?.duration && (
        <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
          Days: rForce is a {issue.mismatchDetails.duration.rforce}-day job, only {issue.mismatchDetails.duration.app} scheduled
        </div>
      )}
      </button>
      {canDismiss && (
        <button
          onClick={onDismiss}
          disabled={dismissing}
          title="Not really scheduled (cancelled in rForce) — clear this issue"
          className="absolute bottom-2 right-3 flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-muted/20 hover:text-foreground disabled:opacity-50"
        >
          <X size={11} />
          {dismissing ? "Dismissing…" : "Dismiss"}
        </button>
      )}
    </div>
  );
}

function DroppedRow({
  issue,
  onClick,
  onCancel,
  onKeep,
  busy,
}: {
  issue: DroppedTileIssue;
  onClick: () => void;
  onCancel: () => void;
  onKeep: () => void;
  busy?: boolean;
}) {
  const city = parseCity(issue.address);
  const rforceUrl = issue.appointment.salesforce_url;

  return (
    <div className="relative border-b border-border hover:bg-muted/10 transition-colors">
      <button onClick={onClick} className="w-full text-left px-4 py-3 pb-12">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-mono text-xs text-muted">{issue.woNumber}</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                {CATEGORY_META.review_cancellation.label}
              </span>
            </div>
            <div className="font-medium text-sm truncate">{issue.customerName}</div>
            {city && (
              <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
                <MapPin size={10} />
                <span className="truncate">{city}</span>
              </div>
            )}
          </div>
          <div className="text-right text-xs shrink-0">
            <div className="text-muted text-[10px]">Booked</div>
            <div>{formatDate(issue.scheduledDate)}</div>
          </div>
        </div>
        <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
          Hasn’t appeared in recent rForce imports — likely cancelled or rescheduled.
          Last seen {formatDate(issue.lastSeen.slice(0, 10))}.
        </div>
      </button>
      <div className="absolute bottom-2 right-3 flex items-center gap-1.5">
        {rforceUrl && (
          <a
            href={rforceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open this work order in rForce to verify"
            className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-muted/20 hover:text-foreground"
          >
            <ExternalLink size={11} />
            Open rForce
          </a>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onKeep();
          }}
          disabled={busy}
          title="It's still a real job — keep the tile and stop flagging it"
          className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-muted/20 hover:text-foreground disabled:opacity-50"
        >
          <Check size={11} />
          Keep tile
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          disabled={busy}
          title="Cancel this appointment (soft-cancel — keeps history)"
          className="flex items-center gap-1 rounded-md bg-red-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
        >
          <Ban size={11} />
          {busy ? "Working…" : "Cancel tile"}
        </button>
      </div>
    </div>
  );
}

export default function IssuesPage() {
  const {
    loading,
    rforceOrders,
    appointments,
    activeLinks,
    crews,
    resourceMappings,
    approveRForce,
    updateAppointment,
    cancelAppointment,
    dismissals,
    dismissRForce,
    exportDates,
  } = useData();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<IssueCategory | "all">("all");
  const [bulk, setBulk] = useState<
    | { phase: "confirm"; total: number }
    | { phase: "running"; done: number; total: number }
    | { phase: "done"; approved: number; skipped: number; failed: number }
    | null
  >(null);
  // Separate bulk flow for extending under-scheduled jobs to rForce's day count.
  const [fixBulk, setFixBulk] = useState<
    | { phase: "confirm"; total: number }
    | { phase: "running"; done: number; total: number }
    | { phase: "done"; fixed: number; skipped: number }
    | null
  >(null);

  // Work orders already placed on the calendar anywhere (incl. outside the
  // loaded date window). Fetched once so already-scheduled past jobs aren't
  // flagged "missing". Refetched after a bulk approve so the list stays honest.
  const [scheduledWos, setScheduledWos] = useState<Set<string>>(new Set());
  const [scheduledWosVersion, setScheduledWosVersion] = useState(0);
  useEffect(() => {
    let active = true;
    fetchScheduledWorkOrderNumbers().then((list) => {
      if (active) setScheduledWos(new Set(list.map((w) => w.trim().toLowerCase())));
    });
    return () => {
      active = false;
    };
  }, [scheduledWosVersion]);

  const allIssues = useMemo(
    () =>
      deriveIssues(rforceOrders, appointments, activeLinks, crews, resourceMappings, scheduledWos, dismissals),
    [rforceOrders, appointments, activeLinks, crews, resourceMappings, scheduledWos, dismissals]
  );

  // Tiles whose backing rForce order silently dropped from imports (cancellation
  // review). Separate shape from SchedulingIssue, so tracked on its own.
  const droppedTiles = useMemo(
    () => deriveDroppedTiles(appointments, rforceOrders, dismissals, exportDates),
    [appointments, rforceOrders, dismissals, exportDates]
  );

  const missingCount = allIssues.filter((i) => i.type === "missing").length;
  const categoryCounts = useMemo(() => {
    const c: Record<IssueCategory, number> = {
      not_scheduled: 0,
      schedule_differs: 0,
      under_scheduled: 0,
      review_cancellation: droppedTiles.length,
    };
    for (const i of allIssues) c[issueCategory(i)]++;
    return c;
  }, [allIssues, droppedTiles]);

  const totalCount = allIssues.length + droppedTiles.length;

  // Missing issues that can be auto-placed (resource maps to a crew).
  const approvable = useMemo(
    () => allIssues.filter((i) => i.type === "missing" && i.placement),
    [allIssues]
  );

  // Under-scheduled jobs whose appointment can be extended to rForce's day-count.
  const underScheduled = useMemo(
    () =>
      allIssues.filter(
        (i) => issueCategory(i) === "under_scheduled" && i.appointment && i.mismatchDetails?.duration
      ),
    [allIssues]
  );

  async function handleFixUnderScheduled() {
    const targets = underScheduled;
    if (targets.length === 0) return;
    let fixed = 0;
    let skipped = 0;
    for (let i = 0; i < targets.length; i++) {
      setFixBulk({ phase: "running", done: i, total: targets.length });
      const issue = targets[i];
      const appt = issue.appointment;
      const targetDays = issue.mismatchDetails?.duration?.rforce;
      if (!appt || !targetDays) {
        skipped++;
        continue;
      }
      try {
        // Extend the tile to span rForce's days. The DB conflict trigger rejects
        // any extension that would collide with another job on the added days —
        // those are skipped, never double-booked.
        await updateAppointment(appt.id, appt.version, { duration_days: targetDays });
        fixed++;
      } catch {
        skipped++;
      }
    }
    setFixBulk({ phase: "done", fixed, skipped });
  }

  async function handleApproveAll() {
    const targets = approvable;
    if (targets.length === 0) return;
    let approved = 0;
    let skipped = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      setBulk({ phase: "running", done: i, total: targets.length });
      const issue = targets[i];
      const p = issue.placement;
      if (!p) {
        skipped++;
        continue;
      }
      try {
        // No override: a job whose crew slot is already booked, or that already
        // exists on the calendar, is skipped rather than silently double-booked.
        await approveRForce(issue.rforceOrder, p.crewId, p.timeBlock, p.scheduledDate);
        approved++;
      } catch {
        // Conflicts (double-book / duplicate WO) and any other failure are
        // skipped — the scheduler can resolve those individually.
        failed++;
      }
    }
    setBulk({ phase: "done", approved, skipped, failed });
    // Refetch the placed-WO set so anything just approved drops off the list.
    setScheduledWosVersion((v) => v + 1);
  }

  const filteredIssues = useMemo(() => {
    let list = allIssues;
    if (typeFilter !== "all") {
      list = list.filter((i) => issueCategory(i) === typeFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.woNumber.toLowerCase().includes(q) ||
          i.customerName.toLowerCase().includes(q) ||
          i.address.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allIssues, typeFilter, search]);

  // Dropped tiles show under "All" and their own category, hidden under others.
  const filteredDropped = useMemo(() => {
    if (typeFilter !== "all" && typeFilter !== "review_cancellation") return [];
    let list = droppedTiles;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (d) =>
          d.woNumber.toLowerCase().includes(q) ||
          d.customerName.toLowerCase().includes(q) ||
          d.address.toLowerCase().includes(q)
      );
    }
    return list;
  }, [droppedTiles, typeFilter, search]);

  // Which dropped tile is mid-action (cancel/keep), keyed by appointment id.
  const [droppedBusyId, setDroppedBusyId] = useState<string | null>(null);

  async function handleCancelDropped(d: DroppedTileIssue) {
    setDroppedBusyId(d.appointment.id);
    try {
      await cancelAppointment(
        d.appointment.id,
        d.appointment.version,
        "Cancelled — dropped from rForce imports"
      );
    } finally {
      setDroppedBusyId(null);
    }
  }

  async function handleKeepDropped(d: DroppedTileIssue) {
    setDroppedBusyId(d.appointment.id);
    try {
      // Suppress the review; if the order reappears it becomes fresh again anyway.
      await dismissRForce(
        d.woNumber,
        d.scheduledDate,
        undefined,
        "Kept — verified still scheduled"
      );
    } finally {
      setDroppedBusyId(null);
    }
  }

  function handleDroppedClick(d: DroppedTileIssue) {
    const crewParam = d.appointment.crew_id ? `&crew=${d.appointment.crew_id}` : "";
    router.push(`/?date=${d.scheduledDate}&view=day${crewParam}`);
  }

  function handleIssueClick(issue: SchedulingIssue) {
    // Jump to the exact resource with the issue: the crew it would land on
    // (missing) or the crew whose tile disagrees (mismatch).
    const crewId =
      issue.type === "missing" ? issue.placement?.crewId : issue.appointment?.crew_id;
    const crewParam = crewId ? `&crew=${crewId}` : "";
    if (issue.type === "missing") {
      // Navigate to rForce date with overlay on
      localStorage.setItem("rbanwo-sched-show-rforce", "true");
      router.push(`/?date=${issue.rforceDate}&view=day${crewParam}`);
    } else {
      // Navigate to app's date (where the tile lives)
      const date = issue.appDate || issue.rforceDate;
      router.push(`/?date=${date}&view=day${crewParam}`);
    }
  }

  // Dismiss a "Not on calendar" issue: mark the rForce order handled so it stops
  // showing here (used for jobs cancelled in rForce that never got a tile).
  const [dismissingKey, setDismissingKey] = useState<string | null>(null);
  async function handleDismissIssue(issue: SchedulingIssue) {
    const key = `${issue.woNumber}|${issue.rforceDate}`;
    setDismissingKey(key);
    try {
      await dismissRForce(
        issue.woNumber,
        issue.rforceDate,
        issue.rforceTime,
        "Dismissed from Issues — not on calendar"
      );
    } finally {
      setDismissingKey(null);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3 sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-500" />
          <h1 className="text-lg font-semibold">
            Issues{" "}
            <span className="text-muted font-normal text-sm">
              ({totalCount})
            </span>
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {underScheduled.length > 0 && (
              <button
                onClick={() => setFixBulk({ phase: "confirm", total: underScheduled.length })}
                title="Extend every under-scheduled job to span all the days rForce lists"
                className="flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600"
              >
                <CheckCheck size={14} />
                Match rForce days ({underScheduled.length})
              </button>
            )}
            {approvable.length > 0 && (
              <button
                onClick={() => setBulk({ phase: "confirm", total: approvable.length })}
                className="flex items-center gap-1.5 rounded-md bg-green-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-600"
              >
                <CheckCheck size={14} />
                Approve all ({approvable.length})
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted mt-0.5">
          rForce jobs that need attention — not on the calendar, scheduled differently, or booked for too few days
        </p>
      </header>

      {bulk && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (bulk.phase !== "running") setBulk(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-background p-4 text-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {bulk.phase === "confirm" && (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <CheckCheck size={16} className="shrink-0 text-green-500" />
                  <h3 className="text-sm font-semibold">Approve all missing jobs?</h3>
                </div>
                <p className="mb-3 text-xs text-foreground/80">
                  This creates a calendar tile for {bulk.total} rForce{" "}
                  {bulk.total === 1 ? "job" : "jobs"}, each placed on its scheduled
                  crew and date. Jobs whose crew slot is already booked, or that
                  already exist on the calendar, are skipped — nothing gets
                  double-booked.
                </p>
                {missingCount > approvable.length && (
                  <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-foreground/80">
                    {missingCount - approvable.length} missing{" "}
                    {missingCount - approvable.length === 1 ? "job" : "jobs"} can’t be
                    auto-placed (no crew match) and must be scheduled manually.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleApproveAll}
                    className="flex-1 rounded-md bg-green-500 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-600"
                  >
                    Approve {bulk.total}
                  </button>
                  <button
                    onClick={() => setBulk(null)}
                    className="flex-1 rounded-md bg-muted/20 py-1.5 text-xs transition-colors hover:bg-muted/40"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {bulk.phase === "running" && (
              <div className="flex flex-col items-center py-2 text-center">
                <Loader2 size={24} className="mb-2 animate-spin text-green-500" />
                <p className="text-sm font-medium">
                  Approving {bulk.done} / {bulk.total}…
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Creating calendar tiles — please keep this open.
                </p>
              </div>
            )}

            {bulk.phase === "done" && (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <CheckCheck size={16} className="shrink-0 text-green-500" />
                  <h3 className="text-sm font-semibold">Done</h3>
                </div>
                <ul className="mb-3 space-y-1 text-xs text-foreground/80">
                  <li>✅ Approved: {bulk.approved}</li>
                  {bulk.failed > 0 && (
                    <li>⚠️ Skipped (conflict / already scheduled): {bulk.failed}</li>
                  )}
                  {bulk.skipped > 0 && <li>↷ Skipped (no crew match): {bulk.skipped}</li>}
                </ul>
                <button
                  onClick={() => setBulk(null)}
                  className="w-full rounded-md bg-muted/20 py-1.5 text-xs transition-colors hover:bg-muted/40"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {fixBulk && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (fixBulk.phase !== "running") setFixBulk(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-background p-4 text-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {fixBulk.phase === "confirm" && (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <CheckCheck size={16} className="shrink-0 text-amber-500" />
                  <h3 className="text-sm font-semibold">Match rForce days?</h3>
                </div>
                <p className="mb-3 text-xs text-foreground/80">
                  Extends {fixBulk.total} under-scheduled{" "}
                  {fixBulk.total === 1 ? "job" : "jobs"} so each tile spans all the
                  days rForce lists. Any job whose extra days are already booked by
                  another appointment is skipped — nothing gets double-booked.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleFixUnderScheduled}
                    className="flex-1 rounded-md bg-amber-500 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600"
                  >
                    Extend {fixBulk.total}
                  </button>
                  <button
                    onClick={() => setFixBulk(null)}
                    className="flex-1 rounded-md bg-muted/20 py-1.5 text-xs transition-colors hover:bg-muted/40"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {fixBulk.phase === "running" && (
              <div className="flex flex-col items-center py-2 text-center">
                <Loader2 size={24} className="mb-2 animate-spin text-amber-500" />
                <p className="text-sm font-medium">
                  Extending {fixBulk.done} / {fixBulk.total}…
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Updating appointment durations — please keep this open.
                </p>
              </div>
            )}

            {fixBulk.phase === "done" && (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <CheckCheck size={16} className="shrink-0 text-amber-500" />
                  <h3 className="text-sm font-semibold">Done</h3>
                </div>
                <ul className="mb-3 space-y-1 text-xs text-foreground/80">
                  <li>✅ Extended: {fixBulk.fixed}</li>
                  {fixBulk.skipped > 0 && (
                    <li>⚠️ Skipped (extra days already booked): {fixBulk.skipped}</li>
                  )}
                </ul>
                <button
                  onClick={() => setFixBulk(null)}
                  className="w-full rounded-md bg-muted/20 py-1.5 text-xs transition-colors hover:bg-muted/40"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-b border-border space-y-2 bg-background sticky top-[62px] z-20">
        {/* Search */}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search WO#, name, address…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Type filter */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "all", label: "All", count: totalCount, desc: "Every rForce work order that needs attention." },
              { key: "not_scheduled", label: CATEGORY_META.not_scheduled.label, count: categoryCounts.not_scheduled, desc: CATEGORY_META.not_scheduled.desc },
              { key: "schedule_differs", label: CATEGORY_META.schedule_differs.label, count: categoryCounts.schedule_differs, desc: CATEGORY_META.schedule_differs.desc },
              { key: "under_scheduled", label: CATEGORY_META.under_scheduled.label, count: categoryCounts.under_scheduled, desc: CATEGORY_META.under_scheduled.desc },
              { key: "review_cancellation", label: CATEGORY_META.review_cancellation.label, count: categoryCounts.review_cancellation, desc: CATEGORY_META.review_cancellation.desc },
            ] as const
          ).map(({ key, label, count, desc }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              title={desc}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                typeFilter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/15 text-muted hover:bg-muted/25"
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
        {/* Plain-language description of the active filter */}
        <p className="text-[11px] text-muted">
          {typeFilter === "all"
            ? "Every rForce work order that needs attention — not on the calendar, scheduled differently, or booked for too few days."
            : CATEGORY_META[typeFilter].desc}
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        {filteredIssues.length === 0 && filteredDropped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted">
            <AlertTriangle size={32} className="mb-2 opacity-30" />
            <p className="text-sm">
              {search || typeFilter !== "all"
                ? "No matching issues found"
                : "No scheduling issues — everything is in sync"}
            </p>
          </div>
        ) : (
          <>
            {filteredDropped.map((d) => (
              <DroppedRow
                key={`dropped-${d.woNumber}-${d.appointment.id}`}
                issue={d}
                onClick={() => handleDroppedClick(d)}
                onCancel={() => handleCancelDropped(d)}
                onKeep={() => handleKeepDropped(d)}
                busy={droppedBusyId === d.appointment.id}
              />
            ))}
            {filteredIssues.map((issue) => (
              <IssueRow
                key={`${issue.type}-${issue.woNumber}`}
                issue={issue}
                onClick={() => handleIssueClick(issue)}
                onDismiss={() => handleDismissIssue(issue)}
                dismissing={dismissingKey === `${issue.woNumber}|${issue.rforceDate}`}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
