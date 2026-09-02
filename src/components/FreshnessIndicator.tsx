"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useData } from "./DataProvider";
import {
  RefreshCw,
  Database,
  Wifi,
  WifiOff,
  Clock,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

/**
 * Staleness thresholds.
 * - Page data older than WARN_MINUTES shows a yellow warning.
 * - Page data older than STALE_MINUTES shows a red alert with auto-refresh prompt.
 * - The rForce daily full export runs ~once a day. If the newest observed export
 *   date is EXPORT_WARN_DAYS or more calendar days old, note that the daily feed
 *   may have stopped. (This tracks the Power Automate daily export via
 *   sched_import_runs / `exportDates`, NOT the legacy manual-CSV-upload table.)
 */
const WARN_MINUTES = 15;
const STALE_MINUTES = 30;
const EXPORT_WARN_DAYS = 2;

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Whole calendar days between a `YYYY-MM-DD` date and today (local). */
function daysSinceDate(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const then = new Date(y, m - 1, d);
  const nowDate = new Date();
  const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  return Math.round((today.getTime() - then.getTime()) / 86_400_000);
}

/** Human label for a `YYYY-MM-DD` export date relative to today. */
function exportDayLabel(ymd: string): string {
  const days = daysSinceDate(ymd);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** Pretty `YYYY-MM-DD` → e.g. "Sep 2" without touching timezones. */
function formatExportDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function FreshnessIndicator() {
  const { connected, rforceOrders, exportDates, loading, refreshData } = useData();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Tick every 30s to update relative times
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Track when data was last loaded
  useEffect(() => {
    if (!loading) {
      setLastRefresh(new Date());
    }
  }, [loading]);

  // Compute most recent rForce update from in-memory data
  const lastRForceUpdate = useMemo(() => {
    if (rforceOrders.length === 0) return null;
    let latest = "";
    for (const r of rforceOrders) {
      if (r.updated_at > latest) latest = r.updated_at;
    }
    return latest || null;
  }, [rforceOrders]);

  // Staleness calculation
  const minutesSinceRefresh = Math.floor(
    (now - lastRefresh.getTime()) / 60_000
  );
  const isWarn = minutesSinceRefresh >= WARN_MINUTES;
  const isStale = minutesSinceRefresh >= STALE_MINUTES;

  // Newest observed daily-export date (`YYYY-MM-DD`, newest first). This is the
  // real rForce feed — Power Automate writes work_orders directly and the app
  // logs each daily export it sees (sched_import_runs). The 30s `now` tick
  // re-renders this, so the day count re-derives after midnight.
  const latestExportDate = exportDates.length > 0 ? exportDates[0] : null;
  const exportAgeDays = latestExportDate ? daysSinceDate(latestExportDate) : null;
  const exportStale =
    exportAgeDays !== null && exportAgeDays >= EXPORT_WARN_DAYS;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshData();
      setLastRefresh(new Date());
    } finally {
      setRefreshing(false);
    }
  }, [refreshData]);

  // Status dot color
  const dotColor = !connected
    ? "bg-danger"
    : isStale
      ? "bg-danger"
      : isWarn
        ? "bg-amber-400"
        : "bg-success";

  const dotTitle = !connected
    ? "Disconnected"
    : isStale
      ? `Data is ${minutesSinceRefresh}m old — refresh recommended`
      : isWarn
        ? `Data refreshed ${minutesSinceRefresh}m ago`
        : "Connected & fresh";

  return (
    <div className="relative">
      {/* Compact indicator — clickable dot */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-1.5 py-1 rounded-full hover:bg-surface transition-colors"
        title={dotTitle}
        aria-label={dotTitle}
      >
        <div className={`w-2 h-2 rounded-full ${dotColor} ${isStale ? "animate-pulse" : ""}`} />
        {(isWarn || !connected) && (
          <span className="text-[10px] text-muted font-medium">
            {!connected ? "Offline" : `${minutesSinceRefresh}m`}
          </span>
        )}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setExpanded(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-xl shadow-lg w-72 p-3 space-y-3 animate-slide-up">
            {/* Connection status */}
            <div className="flex items-center gap-2">
              {connected ? (
                <Wifi size={14} className="text-success shrink-0" />
              ) : (
                <WifiOff size={14} className="text-danger shrink-0" />
              )}
              <span className="text-sm font-medium">
                {connected ? "Connected" : "Disconnected"}
              </span>
              {connected && (
                <span className="text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded-full ml-auto">
                  Live
                </span>
              )}
            </div>

            {/* Page data freshness */}
            <div className="flex items-start gap-2">
              {isStale ? (
                <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" />
              ) : isWarn ? (
                <Clock size={14} className="text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle size={14} className="text-success shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">
                  Page Data
                </div>
                <div className="text-[11px] text-muted">
                  Loaded {timeAgo(lastRefresh.toISOString())}
                  {isStale && (
                    <span className="text-danger font-medium"> — stale, refresh recommended</span>
                  )}
                </div>
              </div>
            </div>

            {/* rForce daily-export freshness (Power Automate feed) */}
            <div className="flex items-start gap-2">
              {exportStale ? (
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <Database size={14} className="text-muted shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">
                  Daily rForce Export
                </div>
                {latestExportDate ? (
                  <div className="text-[11px] text-muted">
                    {formatExportDate(latestExportDate)}
                    {" · "}
                    {exportDayLabel(latestExportDate)}
                    {exportStale && (
                      <span className="text-amber-500 font-medium block">
                        No full export in {exportAgeDays} days — daily feed may have stopped
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted">
                    No export observed yet today
                  </div>
                )}
              </div>
            </div>

            {/* Most recent rForce row update */}
            {lastRForceUpdate && (
              <div className="flex items-start gap-2">
                <Database size={14} className="text-muted shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">
                    Latest rForce Update
                  </div>
                  <div className="text-[11px] text-muted">
                    {formatTimestamp(lastRForceUpdate)}
                    {" · "}
                    {timeAgo(lastRForceUpdate)}
                  </div>
                </div>
              </div>
            )}

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="w-full flex items-center justify-center gap-2 py-2 bg-primary text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw
                size={12}
                className={refreshing ? "animate-spin" : ""}
              />
              {refreshing ? "Refreshing..." : "Refresh Now"}
            </button>

            {/* Info footer */}
            <div className="text-[10px] text-muted/60 text-center">
              Appointment changes sync in real time.
              <br />
              rForce data refreshes on the daily export.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
