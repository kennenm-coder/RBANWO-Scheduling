"use client";

import { useMemo } from "react";
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
} from "lucide-react";

interface Props {
  onClose: () => void;
  onNavigate?: (date: string) => void;
}

const ICON_MAP = {
  time_off_conflict: <Users size={14} className="text-danger" />,
  double_booking: <Calendar size={14} className="text-danger" />,
  discrepancy: <AlertTriangle size={14} className="text-warning" />,
  missing_address: <MapPin size={14} className="text-warning" />,
  manual: <Info size={14} className="text-primary" />,
};

const SEVERITY_ICON = {
  error: <AlertCircle size={14} className="text-danger" />,
  warning: <AlertTriangle size={14} className="text-warning" />,
  info: <Info size={14} className="text-muted" />,
};

export default function IssueCenter({ onClose, onNavigate }: Props) {
  const { appointments, crews, rforceOrders, timeOffRequests } = useData();

  const flags = useMemo(
    () => detectFlags(appointments, crews, rforceOrders, timeOffRequests),
    [appointments, crews, rforceOrders, timeOffRequests]
  );

  const errorCount = flags.filter((f) => f.severity === "error").length;
  const warningCount = flags.filter((f) => f.severity === "warning").length;

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
              {errorCount === 0 && warningCount === 0 && "No issues detected"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-surface"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {flags.length === 0 ? (
            <div className="text-center text-muted py-12 text-sm">
              No scheduling issues detected.
            </div>
          ) : (
            <div className="space-y-2">
              {flags.map((flag) => (
                <FlagRow
                  key={flag.id}
                  flag={flag}
                  onNavigate={onNavigate}
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
  onNavigate,
}: {
  flag: Flag;
  onNavigate?: (date: string) => void;
}) {
  return (
    <button
      onClick={() => flag.date && onNavigate?.(flag.date)}
      className="w-full text-left p-3 rounded-lg border border-border hover:bg-surface transition-colors flex items-start gap-3"
    >
      <div className="mt-0.5">
        {ICON_MAP[flag.type] || SEVERITY_ICON[flag.severity]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm">{flag.message}</div>
        <div className="text-[10px] text-muted mt-0.5 uppercase tracking-wide">
          {flag.type.replace(/_/g, " ")}
          {flag.date && ` · ${flag.date}`}
        </div>
      </div>
    </button>
  );
}
