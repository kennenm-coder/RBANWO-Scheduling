"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/components/DataProvider";
import { detectFlags, Flag } from "@/lib/flags";
import { buildQueueItems } from "@/lib/queue-pipeline";
import { matchCrewByName, timeToBlock } from "@/lib/calendar-utils";
import { parseCity } from "@/lib/crew-utils";
import { QueueItem, RForceOrder, TimeBlock } from "@/lib/types";
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
} from "lucide-react";

const ICON_MAP: Record<string, React.ReactNode> = {
  time_off_conflict: <Users size={14} className="text-danger" />,
  double_booking: <Calendar size={14} className="text-danger" />,
  discrepancy: <AlertTriangle size={14} className="text-warning" />,
  missing_address: <MapPin size={14} className="text-warning" />,
  manual: <Info size={14} className="text-primary" />,
  manual_override: <ArrowRightLeft size={14} className="text-blue-500" />,
  unlinked: <Unlink size={14} className="text-muted" />,
};

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  error: <AlertCircle size={14} className="text-danger" />,
  warning: <AlertTriangle size={14} className="text-warning" />,
  info: <Info size={14} className="text-muted" />,
};

export default function IssuesPage() {
  const {
    appointments, crews, rforceOrders, timeOffRequests,
    unscheduledAppointments, activeLinks, resourceMappings,
    dismissals, flagResolutions, resolveFlag, unresolveFlag,
    approveRForce, dismissRForce, loading,
  } = useData();
  const router = useRouter();
  const [showResolved, setShowResolved] = useState(false);
  const [approvalsExpanded, setApprovalsExpanded] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  const flags = useMemo(
    () => detectFlags(appointments, crews, rforceOrders, timeOffRequests, activeLinks),
    [appointments, crews, rforceOrders, timeOffRequests, activeLinks]
  );

  const resolvedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of flagResolutions) set.add(r.flag_key);
    return set;
  }, [flagResolutions]);

  // Build queue items and filter to needs_confirmation only
  const approvalItems = useMemo(() => {
    const allItems = buildQueueItems(
      rforceOrders, appointments, unscheduledAppointments,
      crews, activeLinks, dismissals, resourceMappings
    );
    return allItems.filter((i) => i.category === "needs_confirmation" && i.rforceOrder);
  }, [rforceOrders, appointments, unscheduledAppointments, crews, activeLinks, dismissals, resourceMappings]);

  // Resolve crew + time block for each approval item
  const approvalData = useMemo(() => {
    return approvalItems.map((item) => {
      const rf = item.rforceOrder!;
      const resourceName = rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
      const crew = resourceName ? matchCrewByName(resourceName, crews, resourceMappings) : undefined;
      const hour = rf.scheduled_start ? parseInt(rf.scheduled_start.slice(11, 13), 10) : 8;
      const isMeasure = crew?.crew_type === "measure_tech";
      const timeBlock: TimeBlock = isMeasure ? timeToBlock(hour) : "full_day";
      const dateStr = rf.scheduled_start?.slice(0, 10) || "";
      return { item, rf, crew, timeBlock, dateStr };
    });
  }, [approvalItems, crews, resourceMappings]);

  const unresolvedFlags = flags.filter((f) => !resolvedKeys.has(f.id));
  const resolvedFlags = flags.filter((f) => resolvedKeys.has(f.id));
  const displayFlags = showResolved ? [...unresolvedFlags, ...resolvedFlags] : unresolvedFlags;

  const errorCount = unresolvedFlags.filter((f) => f.severity === "error").length;
  const warningCount = unresolvedFlags.filter((f) => f.severity === "warning").length;
  const overrideCount = unresolvedFlags.filter((f) => f.type === "manual_override").length;
  const unlinkedCount = unresolvedFlags.filter((f) => f.type === "unlinked").length;

  async function handleApprove(rf: RForceOrder, crewId: string, timeBlock: TimeBlock, dateStr: string) {
    const id = rf.work_order_number;
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      await approveRForce(rf, crewId, timeBlock, dateStr);
    } catch (err) {
      console.error("Approve failed:", err);
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Issues</h1>
            <div className="text-xs text-muted mt-0.5">
              {approvalData.length > 0 && (
                <span className="text-orange-600 dark:text-orange-400 font-medium">{approvalData.length} approvals</span>
              )}
              {approvalData.length > 0 && errorCount > 0 && " · "}
              {errorCount > 0 && (
                <span className="text-danger font-medium">{errorCount} errors</span>
              )}
              {errorCount > 0 && warningCount > 0 && " · "}
              {warningCount > 0 && (
                <span className="text-warning font-medium">{warningCount} warnings</span>
              )}
              {overrideCount > 0 && (
                <>
                  {(errorCount > 0 || warningCount > 0) && " · "}
                  <span className="text-blue-500 font-medium">{overrideCount} overrides</span>
                </>
              )}
              {unlinkedCount > 0 && (
                <>
                  {(errorCount > 0 || warningCount > 0 || overrideCount > 0) && " · "}
                  <span className="text-muted font-medium">{unlinkedCount} unlinked</span>
                </>
              )}
              {resolvedFlags.length > 0 && (
                <>
                  {(errorCount > 0 || warningCount > 0 || overrideCount > 0 || unlinkedCount > 0 || approvalData.length > 0) && " · "}
                  <span className="text-green-600 font-medium">{resolvedFlags.length} resolved</span>
                </>
              )}
              {approvalData.length === 0 && errorCount === 0 && warningCount === 0 && overrideCount === 0 && unlinkedCount === 0 && resolvedFlags.length === 0 && "No issues detected"}
            </div>
          </div>
          {resolvedFlags.length > 0 && (
            <button
              onClick={() => setShowResolved(!showResolved)}
              className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-surface"
              title={showResolved ? "Hide resolved" : "Show resolved"}
            >
              {showResolved ? <EyeOff size={14} /> : <Eye size={14} />}
              {showResolved ? "Hide" : "Show"} resolved
            </button>
          )}
        </div>
      </header>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* ── rForce Approvals Section ── */}
        {approvalData.length > 0 && (
          <div>
            <button
              onClick={() => setApprovalsExpanded(!approvalsExpanded)}
              className="flex items-center gap-2 mb-2 w-full text-left"
            >
              {approvalsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="text-sm font-semibold">rForce Approvals</span>
              <span className="text-xs text-orange-600 dark:text-orange-400 font-medium bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 rounded-full">
                {approvalData.length}
              </span>
            </button>

            {approvalsExpanded && (
              <div className="space-y-1.5">
                {approvalData.map(({ item, rf, crew, timeBlock, dateStr }) => {
                  const city = parseCity(rf.address || "");
                  const isProcessing = processingIds.has(rf.work_order_number);
                  const canApprove = !!crew && !!dateStr;

                  return (
                    <div
                      key={item.id}
                      className="w-full p-3 rounded-lg border-2 border-dashed border-orange-400/50 dark:border-orange-500/30 bg-orange-50/50 dark:bg-orange-900/10 flex items-center gap-3"
                    >
                      {/* Crew color dot */}
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: crew?.color || "#888" }}
                      />

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm truncate">
                            {rf.customer_name || "Unknown"}
                          </span>
                          <span className="text-[9px] font-medium bg-amber-200 dark:bg-amber-800 px-1.5 py-0.5 rounded text-amber-800 dark:text-amber-200 shrink-0">
                            NEW
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                          {city && (
                            <span className="flex items-center gap-0.5">
                              <MapPin size={10} className="shrink-0" />
                              {city}
                            </span>
                          )}
                          {rf.work_order_type && (
                            <span className="font-medium text-foreground/70">
                              {rf.work_order_type}
                            </span>
                          )}
                          {rf.product_count != null && rf.product_count > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Package size={10} />
                              {rf.product_count}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                          <span>{crew?.name || "No crew match"}</span>
                          <span>·</span>
                          <span>{dateStr || "No date"}</span>
                          {timeBlock !== "full_day" && (
                            <>
                              <span>·</span>
                              <span>{timeBlock}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => canApprove && handleApprove(rf, crew!.id, timeBlock, dateStr)}
                          disabled={isProcessing || !canApprove}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-green-500 hover:bg-green-600 text-white text-xs font-medium transition-colors disabled:opacity-50"
                          title={!canApprove ? "Cannot approve — no matching crew" : "Approve"}
                        >
                          {isProcessing ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Check size={12} />
                          )}
                          Approve
                        </button>
                        <button
                          onClick={() => handleDismiss(rf, dateStr)}
                          disabled={isProcessing}
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
            )}
          </div>
        )}

        {/* ── Scheduling Issues Section ── */}
        {displayFlags.length === 0 && approvalData.length === 0 ? (
          <div className="text-center text-muted py-12 text-sm">
            No scheduling issues detected.
          </div>
        ) : displayFlags.length === 0 ? null : (
          <div>
            {approvalData.length > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold">Scheduling Issues</span>
                <span className="text-xs text-muted font-medium bg-surface px-2 py-0.5 rounded-full">
                  {unresolvedFlags.length}
                </span>
              </div>
            )}
            <div className="space-y-2">
              {displayFlags.map((flag) => (
                <FlagRow
                  key={flag.id}
                  flag={flag}
                  resolved={resolvedKeys.has(flag.id)}
                  onNavigate={(date) => router.push(`/#date=${date}&view=day`)}
                  onResolve={() => resolveFlag(flag.id)}
                  onUnresolve={() => unresolveFlag(flag.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FlagRow({
  flag,
  resolved,
  onNavigate,
  onResolve,
  onUnresolve,
}: {
  flag: Flag;
  resolved: boolean;
  onNavigate?: (date: string) => void;
  onResolve: () => void;
  onUnresolve: () => void;
}) {
  return (
    <div
      className={`w-full text-left p-3 rounded-lg border border-border hover:bg-surface transition-colors flex items-start gap-3 ${
        flag.type === "manual_override" ? "border-l-2 border-l-blue-500" : ""
      } ${resolved ? "opacity-50" : ""}`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          resolved ? onUnresolve() : onResolve();
        }}
        className="mt-0.5 shrink-0 text-muted hover:text-green-600 transition-colors"
        title={resolved ? "Mark unresolved" : "Mark resolved"}
      >
        {resolved ? <CheckSquare size={16} className="text-green-600" /> : <Square size={16} />}
      </button>
      <button
        onClick={() => flag.date && onNavigate?.(flag.date)}
        className="flex-1 min-w-0 text-left flex items-start gap-3"
      >
        <div className="mt-0.5 shrink-0">
          {ICON_MAP[flag.type] || SEVERITY_ICON[flag.severity]}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm ${resolved ? "line-through" : ""}`}>{flag.message}</div>
          <div className="text-[10px] text-muted mt-0.5 uppercase tracking-wide">
            {flag.type.replace(/_/g, " ")}
            {flag.date && ` · ${flag.date}`}
          </div>
        </div>
      </button>
    </div>
  );
}
