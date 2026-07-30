"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/components/DataProvider";
import { detectFlags, Flag } from "@/lib/flags";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Calendar,
  MapPin,
  Users,
  Loader2,
} from "lucide-react";

const ICON_MAP: Record<string, React.ReactNode> = {
  time_off_conflict: <Users size={14} className="text-danger" />,
  double_booking: <Calendar size={14} className="text-danger" />,
  discrepancy: <AlertTriangle size={14} className="text-warning" />,
  missing_address: <MapPin size={14} className="text-warning" />,
};

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  error: <AlertCircle size={14} className="text-danger" />,
  warning: <AlertTriangle size={14} className="text-warning" />,
  info: <Info size={14} className="text-muted" />,
};

export default function IssuesPage() {
  const { appointments, crews, rforceOrders, timeOffRequests, loading } = useData();
  const router = useRouter();

  const flags = useMemo(
    () => detectFlags(appointments, crews, rforceOrders, timeOffRequests),
    [appointments, crews, rforceOrders, timeOffRequests]
  );

  const errorCount = flags.filter((f) => f.severity === "error").length;
  const warningCount = flags.filter((f) => f.severity === "warning").length;

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
        <h1 className="text-lg font-semibold">Issues</h1>
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
      </header>
      <div className="flex-1 overflow-auto p-4">
        {flags.length === 0 ? (
          <div className="text-center text-muted py-12 text-sm">
            No scheduling issues detected.
          </div>
        ) : (
          <div className="space-y-2">
            {flags.map((flag) => (
              <button
                key={flag.id}
                onClick={() => {
                  if (flag.date) {
                    router.push(`/#date=${flag.date}&view=day`);
                  }
                }}
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
