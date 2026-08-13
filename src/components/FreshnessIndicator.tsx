"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useData } from "./DataProvider";
import { fetchCsvImports } from "@/lib/import-boundary";
import { CsvImport } from "@/lib/types";
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
 * Staleness thresholds (in minutes).
 * - Page data older than WARN_MINUTES shows a yellow warning.
 * - Page data older than STALE_MINUTES shows a red alert with auto-refresh prompt.
 * - rForce import older than IMPORT_WARN_HOURS shows a note about stale external data.
 */
const WARN_MINUTES = 15;
const STALE_MINUTES = 30;
const IMPORT_WARN_HOURS = 24;

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

export default function FreshnessIndicator() {
  const { connected, rforceOrders, loading, refreshData } = useData();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [lastImport, setLastImport] = useState<CsvImport | null>(null);
  const [importLoading, setImportLoading] = useState(true);
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

  // Fetch last CSV import
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const imports = await fetchCsvImports();
        if (!cancelled && imports.length > 0) {
          setLastImport(imports[0]);
        }
      } catch {
        // Silently fail — indicator just won't show import info
      } finally {
        if (!cancelled) setImportLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [now]); // Re-check periodically

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

  const importAgeHours = lastImport
    ? (now - new Date(lastImport.imported_at).getTime()) / 3_600_000
    : null;
  const importStale =
    importAgeHours !== null && importAgeHours > IMPORT_WARN_HOURS;

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

            {/* rForce import freshness */}
            <div className="flex items-start gap-2">
              {importStale ? (
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <Database size={14} className="text-muted shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">
                  rForce Import
                </div>
                {importLoading ? (
                  <div className="text-[11px] text-muted">Checking...</div>
                ) : lastImport ? (
                  <div className="text-[11px] text-muted">
                    {formatTimestamp(lastImport.imported_at)}
                    {" · "}
                    {timeAgo(lastImport.imported_at)}
                    {lastImport.source === "power_automate" ? " (auto)" : " (manual)"}
                    {importStale && (
                      <span className="text-amber-500 font-medium block">
                        No import in {Math.floor(importAgeHours!)}h — data may be outdated
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted">No imports found</div>
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
              rForce data updates on import.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
