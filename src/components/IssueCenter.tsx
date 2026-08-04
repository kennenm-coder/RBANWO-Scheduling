"use client";

import { useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { detectFlags, Flag } from "@/lib/flags";
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
} from "lucide-react";

interface Props {
  onClose: () => void;
  onNavigate?: (date: string) => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  time_off_conflict: <Users size={14} className="text-danger" />,
  double_booking: <Calendar size={14} className="text-danger" />,
  discrepancy: <AlertTriangle size={14} className="text-warning" />,
  missing_address: <MapPin size={14} className="text-warning" />,
  manual: <Info size={14} className="text-primary" />,
  manual_override: <ArrowRightLeft size={14} className="text-blue-500" />,
  unlinked: <Unlink size={14} className="text-muted" />,
};

const SEVERITY_ICON = {
  error: <AlertCircle size={14} className="text-danger" />,
  warning: <AlertTriangle size={14} className="text-warning" />,
  info: <Info size={14} className="text-muted" />,
};

export default function IssueCenter({ onClose, onNavigate }: Props) {
  const { appointments, crews, rforceOrders, timeOffRequests, activeLinks, flagResolutions, resolveFlag, unresolveFlag } = useData();
  const [showResolved, setShowResolved] = useState(false);

  const flags = useMemo(
    () => detectFlags(appointments, crews, rforceOrders, timeOffRequests, activeLinks),
    [appointments, crews, rforceOrders, timeOffRequests, activeLinks]
  );

  const resolvedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of flagResolutions) set.add(r.flag_key);
    return set;
  }, [flagResolutions]);

  const unresolvedFlags = flags.filter((f) => !resolvedKeys.has(f.id));
  const resolvedFlags = flags.filter((f) => resolvedKeys.has(f.id));
  const displayFlags = showResolved ? [...unresolvedFlags, ...resolvedFlags] : unresolvedFlags;

  const errorCount = unresolvedFlags.filter((f) => f.severity === "error").length;
  const warningCount = unresolvedFlags.filter((f) => f.severity === "warning").length;
  const overrideCount = unresolvedFlags.filter((f) => f.type === "manual_override").length;
  const unlinkedCount = unresolvedFlags.filter((f) => f.type === "unlinked").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-2xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col animate-slide-up">
        <div className="p-4 flex items-center justify-between border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">Issues</h2>
            <div className="text-xs text-muted mt-0.5">
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
                  {(errorCount > 0 || warningCount > 0 || overrideCount > 0 || unlinkedCount > 0) && " · "}
                  <span className="text-green-600 font-medium">{resolvedFlags.length} resolved</span>
                </>
              )}
              {errorCount === 0 && warningCount === 0 && overrideCount === 0 && unlinkedCount === 0 && resolvedFlags.length === 0 && "No issues detected"}
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            <button
              onClick={onClose}
              className="p-1 rounded-full hover:bg-surface"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {displayFlags.length === 0 ? (
            <div className="text-center text-muted py-12 text-sm">
              No scheduling issues detected.
            </div>
          ) : (
            <div className="space-y-2">
              {displayFlags.map((flag) => (
                <FlagRow
                  key={flag.id}
                  flag={flag}
                  resolved={resolvedKeys.has(flag.id)}
                  onNavigate={onNavigate}
                  onResolve={() => resolveFlag(flag.id)}
                  onUnresolve={() => unresolveFlag(flag.id)}
                />
              ))}
            </div>
          )}
        </div>
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
