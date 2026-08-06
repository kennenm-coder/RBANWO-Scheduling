"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/components/DataProvider";
import { detectFlags, applyResolutions, categorizeFlags, countActionableFlags, SchedulingFlag } from "@/lib/flags";
import { buildQueueItems } from "@/lib/queue-pipeline";
import { matchCrewByName, timeToBlock } from "@/lib/calendar-utils";
import { parseCity } from "@/lib/crew-utils";
import { openSalesforce } from "@/lib/salesforce";
import { QueueItem, RForceOrder, TimeBlock, FlagClass } from "@/lib/types";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Calendar,
  MapPin,
  Users,
  ArrowRightLeft,
  Unlink,
  CheckSquare,
  Square,
  Eye,
  EyeOff,
  Loader2,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Package,
  Clock,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  Link2,
  RefreshCw,
} from "lucide-react";

// ── Icon maps ──

const CODE_ICON: Record<string, React.ReactNode> = {
  time_off_conflict: <Users size={14} className="text-danger" />,
  double_booking: <Calendar size={14} className="text-danger" />,
  missing_crew: <Users size={14} className="text-warning" />,
  missing_scheduled_date: <Calendar size={14} className="text-warning" />,
  missing_time: <Clock size={14} className="text-warning" />,
  missing_address: <MapPin size={14} className="text-warning" />,
  invalid_resource_type: <ShieldAlert size={14} className="text-warning" />,
  date_mismatch: <Calendar size={14} className="text-warning" />,
  time_mismatch: <Clock size={14} className="text-warning" />,
  resource_mismatch: <Users size={14} className="text-warning" />,
  type_mismatch: <ArrowRightLeft size={14} className="text-warning" />,
  manual_override_active: <ArrowRightLeft size={14} className="text-blue-500" />,
  unlinked_appointment: <Unlink size={14} className="text-muted" />,
  duplicate_link: <Link2 size={14} className="text-warning" />,
  unmapped_resource: <Users size={14} className="text-muted" />,
  source_record_missing: <AlertTriangle size={14} className="text-muted" />,
};

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  error: <AlertCircle size={14} className="text-danger" />,
  warning: <AlertTriangle size={14} className="text-warning" />,
  info: <Info size={14} className="text-muted" />,
};

const CLASS_LABELS: Record<FlagClass, string> = {
  live_app: "App issue",
  external_confirmation: "rForce sync",
  workflow: "Data integrity",
};

export default function IssuesPage() {
  const {
    appointments, crews, rforceOrders, timeOffRequests,
    unscheduledAppointments, activeLinks, resourceMappings,
    dismissals, flagResolutions, matchRejections,
    resolveFlag, unresolveFlag,
    approveRForce, dismissRForce, loading,
  } = useData();
  const router = useRouter();
  const [showWaiting, setShowWaiting] = useState(true);
  const [approvalsExpanded, setApprovalsExpanded] = useState(true);
  const [actionExpanded, setActionExpanded] = useState(true);
  const [rforceExpanded, setRforceExpanded] = useState(true);
  const [waitingExpanded, setWaitingExpanded] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [errorMap, setErrorMap] = useState<Map<string, string>>(new Map());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; errors: number } | null>(null);

  // Detect all flags
  const rawFlags = useMemo(
    () => detectFlags(appointments, crews, rforceOrders, timeOffRequests, activeLinks),
    [appointments, crews, rforceOrders, timeOffRequests, activeLinks]
  );

  // Apply resolutions → set state to waiting_for_import where appropriate
  const resolvedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of flagResolutions) set.add(r.flag_key);
    return set;
  }, [flagResolutions]);

  const flags = useMemo(
    () => applyResolutions(rawFlags, resolvedKeys),
    [rawFlags, resolvedKeys]
  );

  // Categorize into sections
  const sections = useMemo(() => categorizeFlags(flags), [flags]);

  // Counts
  const actionableCount = countActionableFlags(flags);

  // Build queue items and filter to needs_confirmation only
  const approvalItems = useMemo(() => {
    const allItems = buildQueueItems(
      rforceOrders, appointments, unscheduledAppointments,
      crews, activeLinks, dismissals, resourceMappings, matchRejections
    );
    return allItems.filter((i) => i.category === "needs_confirmation" && i.rforceOrder);
  }, [rforceOrders, appointments, unscheduledAppointments, crews, activeLinks, dismissals, resourceMappings, matchRejections]);

  const approvalData = useMemo(() => {
    return approvalItems.map((item) => {
      const rf = item.rforceOrder!;
      const resourceName = rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
      const crew = resourceName ? matchCrewByName(resourceName, crews, resourceMappings) : undefined;
      const hour = rf.scheduled_start ? parseInt(rf.scheduled_start.slice(11, 13), 10) : 8;
      const isMeasure = crew?.crew_type === "measure_tech";
      const timeBlock: TimeBlock = isMeasure ? timeToBlock(hour) : "full_day";
      const dateStr = rf.scheduled_start?.slice(0, 10) || "";
      const canApprove = !!crew && !!dateStr;
      const reason = !resourceName
        ? "No resource assigned in rForce"
        : !crew
          ? `No crew matches "${resourceName}"`
          : !dateStr
            ? "No scheduled date"
            : undefined;
      return { item, rf, crew, timeBlock, dateStr, canApprove, reason };
    });
  }, [approvalItems, crews, resourceMappings]);

  // Counts for the approve-all button
  const approvableCount = approvalData.filter((d) => d.canApprove).length;

  function friendlyError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "DOUBLE_BOOK") return "Crew already booked on this date";
    if (msg.includes("RLS") || msg.includes("no data")) return "Permission denied — check RLS policies";
    if (msg.includes("violates unique")) return "Crew already booked on this date";
    return msg;
  }

  async function handleApprove(rf: RForceOrder, crewId: string, timeBlock: TimeBlock, dateStr: string) {
    const id = rf.work_order_number;
    setProcessingIds((prev) => new Set(prev).add(id));
    setErrorMap((prev) => { const next = new Map(prev); next.delete(id); return next; });
    try {
      await approveRForce(rf, crewId, timeBlock, dateStr);
    } catch (err) {
      console.error("Approve failed:", err);
      setErrorMap((prev) => new Map(prev).set(id, friendlyError(err)));
    } finally {
      setProcessingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  async function handleDismiss(rf: RForceOrder, dateStr: string) {
    const id = rf.work_order_number;
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      const startTime = rf.scheduled_start?.slice(11, 16);
      await dismissRForce(rf.work_order_number, dateStr, startTime);
    } catch (err) {
      console.error("Dismiss failed:", err);
    } finally {
      setProcessingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  async function handleApproveAll() {
    const approvable = approvalData.filter((d) => d.canApprove);
    if (approvable.length === 0) return;
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: approvable.length, errors: 0 });
    let done = 0;
    let errors = 0;

    // Process in batches of 5 to avoid overwhelming the DB
    const BATCH_SIZE = 5;
    for (let i = 0; i < approvable.length; i += BATCH_SIZE) {
      const batch = approvable.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(({ rf, crew, timeBlock, dateStr }) =>
          approveRForce(rf, crew!.id, timeBlock, dateStr).then(
            () => ({ wo: rf.work_order_number, ok: true as const }),
            (err: unknown) => {
              setErrorMap((prev) => new Map(prev).set(rf.work_order_number, friendlyError(err)));
              return { wo: rf.work_order_number, ok: false as const };
            }
          )
        )
      );
      for (const r of results) {
        done++;
        if (r.status === "fulfilled" && !r.value.ok) errors++;
        if (r.status === "rejected") errors++;
      }
      setBulkProgress({ done, total: approvable.length, errors });
    }
    setBulkRunning(false);
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  const totalOpen = sections.actionRequired.length + sections.updateRForce.length;
  const isEmpty = approvalData.length === 0 && totalOpen === 0 && sections.waitingForImport.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <header className="bg-background border-b border-border px-4 py-3 sticky top-0 z-30">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Issues</h1>
            <div className="text-xs text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
              {approvalData.length > 0 && (
                <span className="text-orange-600 dark:text-orange-400 font-medium">{approvalData.length} approvals</span>
              )}
              {sections.actionRequired.length > 0 && (
                <>
                  {approvalData.length > 0 && <span>·</span>}
                  <span className="text-danger font-medium">{sections.actionRequired.length} action required</span>
                </>
              )}
              {sections.updateRForce.length > 0 && (
                <>
                  {(approvalData.length > 0 || sections.actionRequired.length > 0) && <span>·</span>}
                  <span className="text-warning font-medium">{sections.updateRForce.length} update rForce</span>
                </>
              )}
              {sections.waitingForImport.length > 0 && (
                <>
                  {totalOpen > 0 && <span>·</span>}
                  <span className="text-blue-500 font-medium">{sections.waitingForImport.length} waiting</span>
                </>
              )}
              {isEmpty && "No issues detected"}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* ── rForce Approvals ── */}
        {approvalData.length > 0 && (
          <Section
            title="rForce Approvals"
            count={approvalData.length}
            countColor="text-orange-600 dark:text-orange-400"
            countBg="bg-orange-100 dark:bg-orange-900/30"
            expanded={approvalsExpanded}
            onToggle={() => setApprovalsExpanded(!approvalsExpanded)}
          >
            {/* ── Approve All bar ── */}
            <div className="flex items-center gap-3 mb-3 p-2 rounded-lg bg-surface border border-border">
              <button
                onClick={handleApproveAll}
                disabled={bulkRunning || approvableCount === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-green-500 hover:bg-green-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {bulkRunning ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Approve All ({approvableCount})
              </button>
              <span className="text-xs text-muted">
                {approvableCount} ready
                {approvalData.length - approvableCount > 0 && (
                  <> · <span className="text-warning">{approvalData.length - approvableCount} need crew match</span></>
                )}
              </span>
              {bulkProgress && (
                <span className="text-xs text-muted ml-auto">
                  {bulkProgress.done}/{bulkProgress.total}
                  {bulkProgress.errors > 0 && <span className="text-danger ml-1">({bulkProgress.errors} failed)</span>}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              {approvalData.map(({ item, rf, crew, timeBlock, dateStr, canApprove, reason }) => {
                const city = parseCity(rf.address || "");
                const isProcessing = processingIds.has(rf.work_order_number);
                const error = errorMap.get(rf.work_order_number);
                return (
                  <div
                    key={item.id}
                    className={`w-full p-3 rounded-lg border-2 border-dashed flex items-center gap-3 ${
                      error
                        ? "border-red-400/50 dark:border-red-500/30 bg-red-50/50 dark:bg-red-900/10"
                        : canApprove
                          ? "border-orange-400/50 dark:border-orange-500/30 bg-orange-50/50 dark:bg-orange-900/10"
                          : "border-gray-300/50 dark:border-gray-600/30 bg-gray-50/50 dark:bg-gray-800/20 opacity-60"
                    }`}
                  >
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: crew?.color || "#888" }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{rf.customer_name || "Unknown"}</span>
                        <span className="text-[9px] font-medium bg-amber-200 dark:bg-amber-800 px-1.5 py-0.5 rounded text-amber-800 dark:text-amber-200 shrink-0">NEW</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                        {city && <span className="flex items-center gap-0.5"><MapPin size={10} className="shrink-0" />{city}</span>}
                        {rf.work_order_type && <span className="font-medium text-foreground/70">{rf.work_order_type}</span>}
                        {rf.product_count != null && rf.product_count > 0 && <span className="flex items-center gap-0.5"><Package size={10} />{rf.product_count}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                        <span>{crew?.name || "No crew match"}</span>
                        <span>·</span>
                        <span>{dateStr || "No date"}</span>
                        {timeBlock !== "full_day" && <><span>·</span><span>{timeBlock}</span></>}
                      </div>
                      {/* Error feedback */}
                      {error && (
                        <div className="flex items-center gap-1 text-[11px] text-danger mt-1">
                          <AlertCircle size={10} className="shrink-0" />
                          <span>{error}</span>
                        </div>
                      )}
                      {/* Why can't approve */}
                      {!canApprove && reason && !error && (
                        <div className="flex items-center gap-1 text-[11px] text-warning mt-1">
                          <AlertTriangle size={10} className="shrink-0" />
                          <span>{reason}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => canApprove && handleApprove(rf, crew!.id, timeBlock, dateStr)}
                        disabled={isProcessing || !canApprove || bulkRunning}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          canApprove
                            ? "bg-green-500 hover:bg-green-600 text-white disabled:opacity-50"
                            : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                        }`}
                        title={reason || "Approve"}
                      >
                        {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Approve
                      </button>
                      <button
                        onClick={() => handleDismiss(rf, dateStr)}
                        disabled={isProcessing || bulkRunning}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-muted/20 hover:bg-muted/40 text-muted text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        <X size={12} />
                        Dismiss
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ── Action Required (live app + workflow, open state) ── */}
        {sections.actionRequired.length > 0 && (
          <Section
            title="Action Required"
            subtitle="Fix in the app — these clear automatically"
            count={sections.actionRequired.length}
            countColor="text-danger"
            countBg="bg-red-100 dark:bg-red-900/30"
            expanded={actionExpanded}
            onToggle={() => setActionExpanded(!actionExpanded)}
          >
            <div className="space-y-1.5">
              {sections.actionRequired.map((flag) => (
                <FlagRow
                  key={flag.id}
                  flag={flag}
                  onNavigate={(date) => router.push(`/#date=${date}&view=day`)}
                />
              ))}
            </div>
          </Section>
        )}

        {/* ── Update rForce (external confirmation, open state) ── */}
        {sections.updateRForce.length > 0 && (
          <Section
            title="Update rForce"
            subtitle="App differs from rForce — update the external system"
            count={sections.updateRForce.length}
            countColor="text-warning"
            countBg="bg-amber-100 dark:bg-amber-900/30"
            expanded={rforceExpanded}
            onToggle={() => setRforceExpanded(!rforceExpanded)}
          >
            <div className="space-y-1.5">
              {sections.updateRForce.map((flag) => (
                <FlagRow
                  key={flag.id}
                  flag={flag}
                  onNavigate={(date) => router.push(`/#date=${date}&view=day`)}
                  onAcknowledge={() => resolveFlag(flag.id, "Marked as updated in rForce")}
                />
              ))}
            </div>
          </Section>
        )}

        {/* ── Waiting for Import ── */}
        {sections.waitingForImport.length > 0 && (
          <Section
            title="Waiting for Import"
            subtitle="Scheduler updated rForce — awaiting next CSV import to verify"
            count={sections.waitingForImport.length}
            countColor="text-blue-500"
            countBg="bg-blue-100 dark:bg-blue-900/30"
            expanded={waitingExpanded}
            onToggle={() => setWaitingExpanded(!waitingExpanded)}
          >
            <div className="space-y-1.5">
              {sections.waitingForImport.map((flag) => (
                <FlagRow
                  key={flag.id}
                  flag={flag}
                  isWaiting
                  onNavigate={(date) => router.push(`/#date=${date}&view=day`)}
                  onUndoAcknowledge={() => unresolveFlag(flag.id)}
                />
              ))}
            </div>
          </Section>
        )}

        {/* ── Empty state ── */}
        {isEmpty && (
          <div className="text-center text-muted py-12 text-sm">
            No scheduling issues detected.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section wrapper ──

function Section({
  title,
  subtitle,
  count,
  countColor,
  countBg,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  countColor: string;
  countBg: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button onClick={onToggle} className="flex items-center gap-2 mb-2 w-full text-left group">
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="text-sm font-semibold">{title}</span>
        <span className={`text-xs ${countColor} font-medium ${countBg} px-2 py-0.5 rounded-full`}>
          {count}
        </span>
        {subtitle && (
          <span className="text-[10px] text-muted ml-1 hidden sm:inline">{subtitle}</span>
        )}
      </button>
      {expanded && children}
    </div>
  );
}

// ── Flag Row ──

function FlagRow({
  flag,
  isWaiting,
  onNavigate,
  onAcknowledge,
  onUndoAcknowledge,
}: {
  flag: SchedulingFlag;
  isWaiting?: boolean;
  onNavigate?: (date: string) => void;
  onAcknowledge?: () => void;
  onUndoAcknowledge?: () => void;
}) {
  const icon = CODE_ICON[flag.code] || SEVERITY_ICON[flag.severity];
  const classLabel = CLASS_LABELS[flag.flagClass];

  return (
    <div
      className={`w-full text-left p-3 rounded-lg border border-border hover:bg-surface transition-colors flex items-start gap-3 ${
        flag.code === "manual_override_active" ? "border-l-2 border-l-blue-500" : ""
      } ${isWaiting ? "opacity-60" : ""}`}
    >
      {/* Checkbox / action area */}
      <div className="mt-0.5 shrink-0">
        {flag.canAcknowledge && !isWaiting && onAcknowledge && (
          <button
            onClick={(e) => { e.stopPropagation(); onAcknowledge(); }}
            className="text-muted hover:text-blue-500 transition-colors"
            title="Mark as updated in rForce — waiting for import"
          >
            <Square size={16} />
          </button>
        )}
        {isWaiting && onUndoAcknowledge && (
          <button
            onClick={(e) => { e.stopPropagation(); onUndoAcknowledge(); }}
            className="text-blue-500 hover:text-muted transition-colors"
            title="Undo — not actually updated in rForce"
          >
            <CheckSquare size={16} />
          </button>
        )}
        {flag.autoClears && (
          <div className="w-4 h-4 flex items-center justify-center" title="Clears automatically when fixed">
            <RefreshCw size={11} className="text-muted/50" />
          </div>
        )}
      </div>

      {/* Main content */}
      <button
        onClick={() => flag.date && onNavigate?.(flag.date)}
        className="flex-1 min-w-0 text-left flex items-start gap-3"
      >
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm ${isWaiting ? "line-through" : ""}`}>{flag.message}</div>
          <div className="text-[10px] text-muted mt-0.5 flex items-center gap-2 flex-wrap">
            <span className="uppercase tracking-wide">{classLabel}</span>
            {flag.date && <span>· {flag.date}</span>}
            {flag.workOrderNumber && <span>· WO: {flag.workOrderNumber}</span>}
          </div>
          {/* Resolution hint */}
          <div className="text-[10px] text-muted/70 mt-0.5 flex items-center gap-1">
            <ArrowRight size={8} className="shrink-0" />
            <span>{flag.resolution}</span>
          </div>
          {/* Difference details for external flags */}
          {flag.differences && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {flag.differences.date && (
                <DiffChip label="Date" app={flag.differences.date.app} rforce={flag.differences.date.rforce} />
              )}
              {flag.differences.time && (
                <DiffChip label="Time" app={flag.differences.time.app} rforce={flag.differences.time.rforce} />
              )}
              {flag.differences.crew && (
                <DiffChip label="Crew" app={flag.differences.crew.app} rforce={flag.differences.crew.rforce} />
              )}
              {flag.differences.type && (
                <DiffChip label="Type" app={flag.differences.type.app} rforce={flag.differences.type.rforce} />
              )}
            </div>
          )}
        </div>
      </button>

      {/* Quick actions */}
      <div className="flex gap-1 shrink-0">
        {flag.workOrderNumber && (
          <button
            onClick={(e) => { e.stopPropagation(); openSalesforce(flag.workOrderNumber!, ""); }}
            className="p-1 rounded-md hover:bg-surface text-muted transition-colors"
            title="Open in rForce"
          >
            <ExternalLink size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Difference chip ──

function DiffChip({ label, app, rforce }: { label: string; app: string; rforce: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface text-[9px] text-muted border border-border/50">
      <span className="font-semibold">{label}:</span>
      <span className="text-foreground/80">{app}</span>
      <span>→</span>
      <span className="text-warning">{rforce}</span>
    </span>
  );
}
