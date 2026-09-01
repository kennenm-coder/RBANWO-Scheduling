"use client";

import { useMemo, useState, useCallback } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useData } from "./DataProvider";
import { detectFlags, applyResolutions, categorizeFlags, countActionableFlags, SchedulingFlag } from "@/lib/flags";
import { openSalesforce } from "@/lib/salesforce";
import { timeBlockStartEnd, formatDateStr } from "@/lib/calendar-utils";
import { normalizeWoType } from "@/lib/normalize";
import { deriveTimesFromOrder } from "@/lib/rforce-times";
import { deriveOccupancy } from "@/lib/scheduling-policy";
import { Appointment, FlagClass, FlagCode, TimeBlock } from "@/lib/types";
import {
  X,
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
  Clock,
  ShieldAlert,
  Link2,
  ExternalLink,
  ArrowRight,
  RefreshCw,
  Zap,
  Ban,
  Undo2,
  Check,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Props {
  onClose: () => void;
  onNavigate?: (date: string) => void;
}

const CODE_ICON: Record<string, React.ReactNode> = {
  time_off_conflict: <Users size={14} className="text-danger" />,
  double_booking: <Calendar size={14} className="text-danger" />,
  missing_crew: <Users size={14} className="text-warning" />,
  missing_scheduled_date: <Calendar size={14} className="text-warning" />,
  missing_time: <Clock size={14} className="text-warning" />,
  missing_address: <MapPin size={14} className="text-warning" />,
  invalid_resource_type: <ShieldAlert size={14} className="text-warning" />,
  availability_conflict: <ShieldAlert size={14} className="text-danger" />,
  rforce_cancellation_mismatch: <Ban size={14} className="text-danger" />,
  duplicate_app_appointment: <Calendar size={14} className="text-warning" />,
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

// ─── Filter categories that group related flag codes ─────────────────────────

type FilterKey =
  | "all"
  | "time_off"
  | "double_booking"
  | "date_mismatch"
  | "crew_mismatch"
  | "type_mismatch"
  | "time_issue"
  | "cancellation"
  | "missing_data"
  | "availability"
  | "data_integrity";

interface FilterDef {
  key: FilterKey;
  label: string;
  codes: FlagCode[];
}

const FILTER_DEFS: FilterDef[] = [
  { key: "all", label: "All", codes: [] },
  { key: "time_off", label: "Time Off", codes: ["time_off_conflict"] },
  { key: "double_booking", label: "Double Booking", codes: ["double_booking"] },
  { key: "date_mismatch", label: "Date", codes: ["date_mismatch"] },
  { key: "crew_mismatch", label: "Crew", codes: ["resource_mismatch"] },
  { key: "type_mismatch", label: "Type", codes: ["type_mismatch"] },
  { key: "time_issue", label: "Time", codes: ["time_mismatch", "missing_time", "invalid_time_range", "overlapping_multi_block"] },
  { key: "cancellation", label: "Cancellation", codes: ["rforce_cancellation_mismatch"] },
  { key: "availability", label: "Availability", codes: ["availability_conflict", "invalid_resource_type"] },
  { key: "missing_data", label: "Missing Data", codes: ["missing_crew", "missing_scheduled_date", "missing_address", "duplicate_app_appointment"] },
  { key: "data_integrity", label: "Data Integrity", codes: ["unlinked_appointment", "duplicate_link", "unmapped_resource", "source_record_missing", "manual_override_active"] },
];

function matchesFilter(flag: SchedulingFlag, filter: FilterKey): boolean {
  if (filter === "all") return true;
  const def = FILTER_DEFS.find((d) => d.key === filter);
  return def ? def.codes.includes(flag.code) : true;
}

function matchesSearch(flag: SchedulingFlag, query: string, appointments: Appointment[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (flag.message.toLowerCase().includes(q)) return true;
  if (flag.workOrderNumber?.toLowerCase().includes(q)) return true;
  if (flag.date?.includes(q)) return true;
  // Also search by customer name from the linked appointment
  if (flag.appointmentId) {
    const appt = appointments.find((a) => a.id === flag.appointmentId);
    if (appt?.customer_name.toLowerCase().includes(q)) return true;
    if (appt?.address.toLowerCase().includes(q)) return true;
  }
  return false;
}

export default function IssueCenter({ onClose, onNavigate }: Props) {
  const { appointments, crews, rforceOrders, timeOffRequests, activeLinks, flagResolutions, availabilityRules, availabilityExceptions, calendarBlocks, resolveFlag, unresolveFlag } = useData();
  useEscapeKey(useCallback(() => onClose(), [onClose]));
  const [showWaiting, setShowWaiting] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const rawFlags = useMemo(
    () => detectFlags(appointments, crews, rforceOrders, timeOffRequests, activeLinks, availabilityRules, availabilityExceptions, undefined, calendarBlocks),
    [appointments, crews, rforceOrders, timeOffRequests, activeLinks, availabilityRules, availabilityExceptions, calendarBlocks]
  );

  const resolvedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of flagResolutions) set.add(r.flag_key);
    return set;
  }, [flagResolutions]);

  const flags = useMemo(
    () => applyResolutions(rawFlags, resolvedKeys),
    [rawFlags, resolvedKeys]
  );

  const sections = useMemo(() => categorizeFlags(flags), [flags]);

  // Count issues per filter (unfiltered, for badge numbers)
  const allOpenFlags = useMemo(
    () => [...sections.actionRequired, ...sections.updateRForce],
    [sections]
  );

  const filterCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = {} as Record<FilterKey, number>;
    for (const def of FILTER_DEFS) {
      if (def.key === "all") {
        counts.all = allOpenFlags.length;
      } else {
        counts[def.key] = allOpenFlags.filter((f) => def.codes.includes(f.code)).length;
      }
    }
    return counts;
  }, [allOpenFlags]);

  // Apply search + filter to each section
  const filtered = useMemo(() => {
    const applyFilters = (list: SchedulingFlag[]) =>
      list
        .filter((f) => matchesFilter(f, activeFilter))
        .filter((f) => matchesSearch(f, searchQuery, appointments));

    return {
      actionRequired: applyFilters(sections.actionRequired),
      updateRForce: applyFilters(sections.updateRForce),
      waitingForImport: applyFilters(sections.waitingForImport),
      resolved: applyFilters(sections.resolved),
    };
  }, [sections, activeFilter, searchQuery, appointments]);

  const totalOpen = sections.actionRequired.length + sections.updateRForce.length;
  const filteredOpen = filtered.actionRequired.length + filtered.updateRForce.length;

  // Locally-applied fixes: track IDs that were resolved in this session via QuickFixes
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const markApplied = useCallback((id: string) => {
    setAppliedIds((prev) => new Set(prev).add(id));
  }, []);

  // Separate applied flags from the visible lists so they sink to the bottom
  const visibleActionRequired = filtered.actionRequired.filter((f) => !appliedIds.has(f.id));
  const visibleUpdateRForce = filtered.updateRForce.filter((f) => !appliedIds.has(f.id));
  const appliedFlags = [...filtered.actionRequired, ...filtered.updateRForce].filter((f) => appliedIds.has(f.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-2xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col animate-slide-up">
        {/* Header */}
        <div className="p-4 flex items-center justify-between border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">Issues</h2>
            <div className="text-xs text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
              {sections.actionRequired.length > 0 && (
                <span className="text-danger font-medium">{sections.actionRequired.length} action required</span>
              )}
              {sections.updateRForce.length > 0 && (
                <>
                  {sections.actionRequired.length > 0 && <span>·</span>}
                  <span className="text-warning font-medium">{sections.updateRForce.length} update rForce</span>
                </>
              )}
              {sections.waitingForImport.length > 0 && (
                <>
                  {totalOpen > 0 && <span>·</span>}
                  <span className="text-blue-500 font-medium">{sections.waitingForImport.length} waiting</span>
                </>
              )}
              {totalOpen === 0 && sections.waitingForImport.length === 0 && "No issues detected"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Search toggle */}
            <button
              onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearchQuery(""); }}
              className={`p-1.5 rounded-full transition-colors ${searchOpen ? "bg-primary/10 text-primary" : "hover:bg-surface text-muted"}`}
              title="Search issues"
            >
              <Search size={16} />
            </button>
            {sections.waitingForImport.length > 0 && (
              <button
                onClick={() => setShowWaiting(!showWaiting)}
                className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-surface"
                title={showWaiting ? "Hide waiting" : "Show waiting"}
              >
                {showWaiting ? <EyeOff size={14} /> : <Eye size={14} />}
                {showWaiting ? "Hide" : "Show"} waiting
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded-full hover:bg-surface">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Search bar (collapsible) */}
        {searchOpen && (
          <div className="px-4 pt-3 pb-0">
            <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-1.5">
              <Search size={14} className="text-muted shrink-0" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, WO#, address, date..."
                className="bg-transparent text-sm outline-none w-full"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="p-0.5 rounded-full hover:bg-border">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Filter chips */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {FILTER_DEFS.map((def) => {
            const count = filterCounts[def.key];
            // Hide filter chips with 0 issues (except "All")
            if (def.key !== "all" && count === 0) return null;
            const isActive = activeFilter === def.key;
            return (
              <button
                key={def.key}
                onClick={() => setActiveFilter(def.key)}
                className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border ${
                  isActive
                    ? "bg-primary text-white border-primary"
                    : "bg-surface border-border text-muted hover:text-foreground hover:border-foreground/20"
                }`}
              >
                {def.label}
                {def.key !== "all" && (
                  <span className={`text-[10px] ${isActive ? "text-white/70" : "text-muted"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Filtered count indicator */}
        {(activeFilter !== "all" || searchQuery) && (
          <div className="px-4 pb-1 text-[10px] text-muted">
            Showing {filteredOpen} of {totalOpen} open issues
            {searchQuery && ` matching "${searchQuery}"`}
            {activeFilter !== "all" && (
              <button
                onClick={() => { setActiveFilter("all"); setSearchQuery(""); }}
                className="ml-1.5 text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Issue list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Action Required */}
          {visibleActionRequired.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-danger mb-2 uppercase tracking-wide">
                Action Required ({visibleActionRequired.length})
              </div>
              <div className="space-y-1.5">
                {visibleActionRequired.map((flag) => (
                  <FlagRow key={flag.id} flag={flag} onNavigate={onNavigate} onApplied={() => markApplied(flag.id)} />
                ))}
              </div>
            </div>
          )}

          {/* Update rForce */}
          {visibleUpdateRForce.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-warning mb-2 uppercase tracking-wide">
                Update rForce ({visibleUpdateRForce.length})
              </div>
              <div className="space-y-1.5">
                {visibleUpdateRForce.map((flag) => (
                  <FlagRow
                    key={flag.id}
                    flag={flag}
                    onNavigate={onNavigate}
                    onAcknowledge={() => resolveFlag(flag.id, "Marked as updated in rForce")}
                    onApplied={() => markApplied(flag.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Waiting for Import */}
          {showWaiting && filtered.waitingForImport.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-blue-500 mb-2 uppercase tracking-wide">
                Waiting for Import ({filtered.waitingForImport.length})
              </div>
              <div className="space-y-1.5">
                {filtered.waitingForImport.map((flag) => (
                  <FlagRow
                    key={flag.id}
                    flag={flag}
                    isWaiting
                    onNavigate={onNavigate}
                    onUndoAcknowledge={() => unresolveFlag(flag.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Resolved this session (sunk to bottom) ── */}
          {appliedFlags.length > 0 && (
            <div>
              <button
                onClick={() => setShowResolved(!showResolved)}
                className="flex items-center gap-1.5 text-xs font-semibold text-success mb-2 uppercase tracking-wide hover:text-success/80 transition-colors"
              >
                {showResolved ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                Resolved ({appliedFlags.length})
              </button>
              {showResolved && (
                <div className="space-y-1.5">
                  {appliedFlags.map((flag) => (
                    <FlagRow key={flag.id} flag={flag} isResolved onNavigate={onNavigate} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {visibleActionRequired.length === 0 && visibleUpdateRForce.length === 0 && filtered.waitingForImport.length === 0 && appliedFlags.length === 0 && (
            <div className="text-center text-muted py-12 text-sm">
              {activeFilter !== "all" || searchQuery
                ? "No issues match your filters."
                : "No scheduling issues detected."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FlagRow({
  flag,
  isWaiting,
  isResolved,
  onNavigate,
  onAcknowledge,
  onUndoAcknowledge,
  onApplied,
}: {
  flag: SchedulingFlag;
  isWaiting?: boolean;
  isResolved?: boolean;
  onNavigate?: (date: string) => void;
  onAcknowledge?: () => void;
  onUndoAcknowledge?: () => void;
  onApplied?: () => void;
}) {
  const icon = CODE_ICON[flag.code] || SEVERITY_ICON[flag.severity];

  return (
    <div
      className={`w-full text-left p-3 rounded-lg border border-border hover:bg-surface transition-colors ${
        flag.code === "manual_override_active" ? "border-l-2 border-l-blue-500" : ""
      } ${isWaiting ? "opacity-50" : ""} ${isResolved ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox area */}
        <div className="mt-0.5 shrink-0">
          {flag.canAcknowledge && !isWaiting && !isResolved && onAcknowledge && (
            <button
              onClick={(e) => { e.stopPropagation(); onAcknowledge(); }}
              className="text-muted hover:text-blue-500 transition-colors"
              title="Mark as updated in rForce"
            >
              <Square size={16} />
            </button>
          )}
          {isWaiting && onUndoAcknowledge && (
            <button
              onClick={(e) => { e.stopPropagation(); onUndoAcknowledge(); }}
              className="text-blue-500 hover:text-muted transition-colors"
              title="Undo"
            >
              <CheckSquare size={16} />
            </button>
          )}
          {isResolved && (
            <div className="w-4 h-4 flex items-center justify-center" title="Resolved">
              <Check size={14} className="text-success" />
            </div>
          )}
          {flag.autoClears && !isResolved && (
            <div className="w-4 h-4 flex items-center justify-center" title="Clears automatically when fixed">
              <RefreshCw size={11} className="text-muted/50" />
            </div>
          )}
        </div>

        <button
          onClick={() => flag.date && onNavigate?.(flag.date)}
          className="flex-1 min-w-0 text-left flex items-start gap-3"
        >
          <div className="mt-0.5 shrink-0">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className={`text-sm ${isWaiting || isResolved ? "line-through" : ""}`}>{flag.message}</div>
            <div className="text-[10px] text-muted mt-0.5">
              {CLASS_LABELS[flag.flagClass]}
              {flag.date && ` · ${formatDateStr(flag.date)}`}
              {flag.workOrderNumber && ` · WO: ${flag.workOrderNumber}`}
            </div>
          </div>
        </button>

        {flag.workOrderNumber && (
          <button
            onClick={(e) => { e.stopPropagation(); openSalesforce(flag.workOrderNumber!, ""); }}
            className="p-1 rounded-md hover:bg-surface text-muted transition-colors shrink-0"
            title="Open in rForce"
          >
            <ExternalLink size={12} />
          </button>
        )}
      </div>

      {/* Suggested fixes */}
      {!isWaiting && !isResolved && <QuickFixes flag={flag} onNavigate={onNavigate} onApplied={onApplied} />}
    </div>
  );
}

// ─── Quick Fix Buttons ───────────────────────────────────────────────────────

function QuickFixes({
  flag,
  onNavigate,
  onApplied,
}: {
  flag: SchedulingFlag;
  onNavigate?: (date: string) => void;
  onApplied?: () => void;
}) {
  const { appointments, crews, rforceOrders, updateAppointment, cancelAppointment, unscheduleAppointment } = useData();
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  if (applied) {
    return (
      <div className="mt-2 ml-7 flex items-center gap-1.5 text-[11px] text-success">
        <Check size={12} /> Applied
      </div>
    );
  }

  const appt = flag.appointmentId
    ? appointments.find((a) => a.id === flag.appointmentId)
    : null;

  async function runFix(label: string, fn: () => Promise<void>) {
    setApplying(label);
    try {
      await fn();
      setApplied(true);
      onApplied?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg === "VERSION_CONFLICT") {
        alert("Someone else just updated this appointment — please refresh.");
      } else {
        alert(`Fix failed: ${msg}`);
      }
    } finally {
      setApplying(null);
    }
  }

  const fixes: { label: string; icon: React.ReactNode; action: () => Promise<void>; variant?: "danger" | "primary" }[] = [];

  // ── Date mismatch: accept rForce date ──
  if (flag.code === "date_mismatch" && appt && flag.differences?.date) {
    const rfDate = flag.differences.date.rforce;
    fixes.push({
      label: `Accept rForce date (${rfDate})`,
      icon: <Calendar size={11} />,
      action: async () => {
        await updateAppointment(appt.id, appt.version, { scheduled_date: rfDate });
      },
    });
  }

  // ── Resource mismatch: accept rForce crew ──
  if (flag.code === "resource_mismatch" && appt && flag.differences?.crew) {
    const rfCrewName = flag.differences.crew.rforce;
    const matchedCrew = crews.find((c) => {
      const cFirst = c.name.toLowerCase().split(" ")[0];
      const rfFirst = rfCrewName.toLowerCase().split(" ")[0];
      return cFirst === rfFirst;
    });
    if (matchedCrew) {
      fixes.push({
        label: `Accept rForce crew (${matchedCrew.name})`,
        icon: <Users size={11} />,
        action: async () => {
          await updateAppointment(appt.id, appt.version, { crew_id: matchedCrew.id });
        },
      });
    }
  }

  // ── Time mismatch: accept rForce time ──
  if (flag.code === "time_mismatch" && appt && flag.differences?.time) {
    const rfTimeStr = flag.differences.time.rforce;
    // Prefer the linked order's REAL window (exact start/end + natural block) via
    // the shared derivation. Fall back to a block-rounded time only when the
    // order or its scheduled window isn't available.
    const normWo = (appt.work_order_number || "").trim().toLowerCase();
    const linkedOrder = normWo
      ? rforceOrders.find((o) => (o.work_order_number || "").trim().toLowerCase() === normWo)
      : undefined;
    const derived = linkedOrder
      ? deriveTimesFromOrder(linkedOrder.scheduled_start, linkedOrder.scheduled_end, appt.appointment_type)
      : null;

    let update: { time_block: TimeBlock | null; start_time: string; end_time: string } | null = null;
    if (derived) {
      update = { time_block: derived.time_block, start_time: derived.start_time, end_time: derived.end_time };
    } else {
      // Fallback: map the rForce hour to its block.
      const rfHour = parseInt(rfTimeStr.split(":")[0], 10);
      let targetBlock: TimeBlock | null = null;
      if (!isNaN(rfHour)) {
        if (rfHour < 10) targetBlock = "9-10";
        else if (rfHour < 12) targetBlock = "10-12";
        else if (rfHour < 14) targetBlock = "12-2";
        else if (rfHour < 16) targetBlock = "2-4";
        else targetBlock = "4-6";
      }
      if (targetBlock) {
        const times = timeBlockStartEnd(targetBlock);
        update = { time_block: targetBlock, start_time: times.start, end_time: times.end };
      }
    }

    if (update) {
      const occ = deriveOccupancy({
        timeBlock: update.time_block,
        startTime: update.start_time,
        endTime: update.end_time,
      });
      const fullUpdate = { ...update, is_full_day: occ.is_full_day, resource_hours: occ.resource_hours };
      fixes.push({
        label: `Accept rForce time (${rfTimeStr})`,
        icon: <Clock size={11} />,
        action: async () => {
          await updateAppointment(appt.id, appt.version, fullUpdate);
        },
      });
    }
  }

  // ── Type mismatch: accept rForce type ──
  if (flag.code === "type_mismatch" && appt && flag.differences?.type) {
    const rfType = normalizeWoType(flag.differences.type.rforce);
    if (rfType) {
      fixes.push({
        label: `Accept rForce type (${rfType.replace(/_/g, " ")})`,
        icon: <ArrowRightLeft size={11} />,
        action: async () => {
          await updateAppointment(appt.id, appt.version, { appointment_type: rfType });
        },
      });
    }
  }

  // ── rForce cancellation: cancel the appointment ──
  if (flag.code === "rforce_cancellation_mismatch" && appt) {
    fixes.push({
      label: "Cancel appointment",
      icon: <Ban size={11} />,
      variant: "danger",
      action: async () => {
        await cancelAppointment(appt.id, appt.version, "Cancelled — rForce WO was cancelled");
      },
    });
  }

  // ── Double booking: unschedule the flagged appointment ──
  if (flag.code === "double_booking" && appt) {
    fixes.push({
      label: `Unschedule ${appt.customer_name.split(" ").slice(-1)[0]}`,
      icon: <Undo2 size={11} />,
      action: async () => {
        await unscheduleAppointment(appt.id, appt.version, "Unscheduled — double-booking conflict");
      },
    });
  }

  // ── Time-off conflict: unschedule ──
  if (flag.code === "time_off_conflict" && appt) {
    fixes.push({
      label: "Unschedule (return to queue)",
      icon: <Undo2 size={11} />,
      action: async () => {
        await unscheduleAppointment(appt.id, appt.version, "Unscheduled — crew has time off");
      },
    });
  }

  // ── Missing time block: set to full_day ──
  if (flag.code === "missing_time" && appt) {
    const times = timeBlockStartEnd("full_day");
    fixes.push({
      label: "Set to Full Day",
      icon: <Clock size={11} />,
      action: async () => {
        await updateAppointment(appt.id, appt.version, {
          time_block: "full_day",
          start_time: times.start,
          end_time: times.end,
          is_full_day: true,
          resource_hours: null,
        });
      },
    });
  }

  // ── Availability conflict: unschedule ──
  if (flag.code === "availability_conflict" && appt) {
    fixes.push({
      label: "Unschedule (return to queue)",
      icon: <Undo2 size={11} />,
      action: async () => {
        await unscheduleAppointment(appt.id, appt.version, "Unscheduled — crew unavailable");
      },
    });
  }

  if (fixes.length === 0) return null;

  return (
    <div className="mt-2 ml-7 flex flex-wrap items-center gap-1.5">
      <Zap size={10} className="text-amber-500 shrink-0" />
      {fixes.map((fix) => (
        <button
          key={fix.label}
          onClick={() => runFix(fix.label, fix.action)}
          disabled={!!applying}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
            fix.variant === "danger"
              ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
              : "bg-primary/10 text-primary hover:bg-primary/20"
          } ${applying ? "opacity-50 cursor-wait" : ""}`}
          title={fix.label}
        >
          {applying === fix.label ? (
            <RefreshCw size={10} className="animate-spin" />
          ) : (
            fix.icon
          )}
          <span>{fix.label}</span>
        </button>
      ))}
      {flag.date && onNavigate && (
        <button
          onClick={() => onNavigate(flag.date!)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface text-muted hover:text-foreground transition-colors"
          title="View in calendar"
        >
          <Calendar size={10} />
          View day
        </button>
      )}
    </div>
  );
}
