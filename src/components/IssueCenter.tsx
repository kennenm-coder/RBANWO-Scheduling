"use client";

import { useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { detectFlags, applyResolutions, categorizeFlags, countActionableFlags, SchedulingFlag } from "@/lib/flags";
import { openSalesforce } from "@/lib/salesforce";
import { timeBlockStartEnd } from "@/lib/calendar-utils";
import { normalizeWoType } from "@/lib/normalize";
import { Appointment, FlagClass, TimeBlock } from "@/lib/types";
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

export default function IssueCenter({ onClose, onNavigate }: Props) {
  const { appointments, crews, rforceOrders, timeOffRequests, activeLinks, flagResolutions, availabilityRules, availabilityExceptions, resolveFlag, unresolveFlag } = useData();
  const [showWaiting, setShowWaiting] = useState(true);

  const rawFlags = useMemo(
    () => detectFlags(appointments, crews, rforceOrders, timeOffRequests, activeLinks, availabilityRules, availabilityExceptions),
    [appointments, crews, rforceOrders, timeOffRequests, activeLinks, availabilityRules, availabilityExceptions]
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
  const actionableCount = countActionableFlags(flags);

  const totalOpen = sections.actionRequired.length + sections.updateRForce.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-2xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col animate-slide-up">
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

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Action Required */}
          {sections.actionRequired.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-danger mb-2 uppercase tracking-wide">
                Action Required ({sections.actionRequired.length})
              </div>
              <div className="space-y-1.5">
                {sections.actionRequired.map((flag) => (
                  <FlagRow key={flag.id} flag={flag} onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          )}

          {/* Update rForce */}
          {sections.updateRForce.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-warning mb-2 uppercase tracking-wide">
                Update rForce ({sections.updateRForce.length})
              </div>
              <div className="space-y-1.5">
                {sections.updateRForce.map((flag) => (
                  <FlagRow
                    key={flag.id}
                    flag={flag}
                    onNavigate={onNavigate}
                    onAcknowledge={() => resolveFlag(flag.id, "Marked as updated in rForce")}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Waiting for Import */}
          {showWaiting && sections.waitingForImport.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-blue-500 mb-2 uppercase tracking-wide">
                Waiting for Import ({sections.waitingForImport.length})
              </div>
              <div className="space-y-1.5">
                {sections.waitingForImport.map((flag) => (
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

          {/* Empty state */}
          {totalOpen === 0 && sections.waitingForImport.length === 0 && (
            <div className="text-center text-muted py-12 text-sm">
              No scheduling issues detected.
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

  return (
    <div
      className={`w-full text-left p-3 rounded-lg border border-border hover:bg-surface transition-colors ${
        flag.code === "manual_override_active" ? "border-l-2 border-l-blue-500" : ""
      } ${isWaiting ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox area */}
        <div className="mt-0.5 shrink-0">
          {flag.canAcknowledge && !isWaiting && onAcknowledge && (
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
          {flag.autoClears && (
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
            <div className={`text-sm ${isWaiting ? "line-through" : ""}`}>{flag.message}</div>
            <div className="text-[10px] text-muted mt-0.5">
              {CLASS_LABELS[flag.flagClass]}
              {flag.date && ` · ${flag.date}`}
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
      {!isWaiting && <QuickFixes flag={flag} onNavigate={onNavigate} />}
    </div>
  );
}

// ─── Quick Fix Buttons ───────────────────────────────────────────────────────

function QuickFixes({
  flag,
  onNavigate,
}: {
  flag: SchedulingFlag;
  onNavigate?: (date: string) => void;
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
    // Try to map rForce time to the closest time block
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
      fixes.push({
        label: `Accept rForce time (${rfTimeStr})`,
        icon: <Clock size={11} />,
        action: async () => {
          await updateAppointment(appt.id, appt.version, {
            time_block: targetBlock!,
            start_time: times.start,
            end_time: times.end,
          });
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
