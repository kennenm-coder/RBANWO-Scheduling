"use client";

import { useData } from "@/components/DataProvider";
import { exportAppointments, exportComparison } from "@/lib/csv-export";
import { Loader2, Download, ArrowRightLeft } from "lucide-react";

export default function AdminPage() {
  const {
    appointments, unscheduledAppointments, rforceOrders,
    crews, activeLinks, loading,
  } = useData();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  const allAppointments = [...appointments, ...unscheduledAppointments];
  const activeAppts = allAppointments.filter((a) => a.status !== "cancelled");

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3 sticky top-0 z-30">
        <h1 className="text-lg font-semibold">Admin</h1>
      </header>
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* ── CSV Exports ── */}
        <div>
          <h2 className="text-sm font-semibold mb-1">Data Exports</h2>
          <p className="text-xs text-muted mb-3">
            Export app data as CSV to compare against rForce imports and track data cleanup.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => exportAppointments(allAppointments, crews, activeLinks)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-muted/20 transition-colors text-sm font-medium"
            >
              <Download size={16} className="text-primary" />
              <div className="text-left">
                <div>App Appointments</div>
                <div className="text-[10px] text-muted font-normal">{activeAppts.length} records</div>
              </div>
            </button>

            <button
              onClick={() => exportComparison(allAppointments, rforceOrders, crews, activeLinks)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-muted/20 transition-colors text-sm font-medium"
            >
              <ArrowRightLeft size={16} className="text-orange-500" />
              <div className="text-left">
                <div>App vs rForce</div>
                <div className="text-[10px] text-muted font-normal">
                  {activeAppts.length} app · {rforceOrders.length} rForce
                </div>
              </div>
            </button>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-xs text-muted">
            <strong>App Appointments</strong> — all active appointments in the scheduling app with crew, date, WO#, and link status.
            <br />
            <strong>App vs rForce</strong> — side-by-side comparison matched by work order number. Columns flag date/crew mismatches and items that exist in only one system.
          </p>
        </div>
      </div>
    </div>
  );
}
