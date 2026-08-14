"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/components/DataProvider";
import { deriveIssues, type IssueType, type SchedulingIssue } from "@/lib/issues";
import { Loader2, AlertTriangle, ArrowRightLeft, Search, MapPin } from "lucide-react";
import { format, parseISO } from "date-fns";

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "MMM d, yyyy");
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string | undefined): string {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function parseCity(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((p) => p.trim());
  return parts.length >= 3 ? parts[parts.length - 2] : parts[0] || "";
}

function IssueRow({ issue, onClick }: { issue: SchedulingIssue; onClick: () => void }) {
  const city = parseCity(issue.address);

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 border-b border-border hover:bg-muted/10 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-xs text-muted">{issue.woNumber}</span>
            {issue.type === "missing" ? (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                Missing
              </span>
            ) : (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                Mismatch
              </span>
            )}
          </div>
          <div className="font-medium text-sm truncate">{issue.customerName}</div>
          {city && (
            <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
              <MapPin size={10} />
              <span className="truncate">{city}</span>
            </div>
          )}
        </div>
        <div className="text-right text-xs shrink-0">
          {issue.type === "missing" ? (
            <div>
              <div className="text-muted text-[10px]">rForce</div>
              <div>{formatDate(issue.rforceDate)}</div>
              {issue.rforceTime && (
                <div className="text-muted">{formatTime(issue.rforceTime)}</div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div>
                <div className="text-muted text-[10px]">rForce</div>
                <div>{formatDate(issue.rforceDate)}</div>
                {issue.mismatchDetails?.time && (
                  <div className="text-muted">{formatTime(issue.rforceTime)}</div>
                )}
              </div>
              <ArrowRightLeft size={12} className="text-muted shrink-0" />
              <div>
                <div className="text-muted text-[10px]">App</div>
                <div>{formatDate(issue.appDate)}</div>
                {issue.mismatchDetails?.time && (
                  <div className="text-muted">{formatTime(issue.appTime)}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {issue.mismatchDetails?.crew && (
        <div className="text-[10px] text-muted mt-1">
          Crew: {issue.mismatchDetails.crew.rforce} (rForce) → {issue.mismatchDetails.crew.app} (App)
        </div>
      )}
    </button>
  );
}

export default function IssuesPage() {
  const {
    loading,
    rforceOrders,
    appointments,
    activeLinks,
    crews,
    resourceMappings,
  } = useData();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<IssueType | "all">("all");

  const allIssues = useMemo(
    () => deriveIssues(rforceOrders, appointments, activeLinks, crews, resourceMappings),
    [rforceOrders, appointments, activeLinks, crews, resourceMappings]
  );

  const missingCount = allIssues.filter((i) => i.type === "missing").length;
  const mismatchCount = allIssues.filter((i) => i.type === "mismatch").length;

  const filteredIssues = useMemo(() => {
    let list = allIssues;
    if (typeFilter !== "all") {
      list = list.filter((i) => i.type === typeFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.woNumber.toLowerCase().includes(q) ||
          i.customerName.toLowerCase().includes(q) ||
          i.address.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allIssues, typeFilter, search]);

  function handleIssueClick(issue: SchedulingIssue) {
    if (issue.type === "missing") {
      // Navigate to rForce date with overlay on
      localStorage.setItem("rbanwo-sched-show-rforce", "true");
      router.push(`/?date=${issue.rforceDate}&view=day`);
    } else {
      // Navigate to app's date (where the tile lives)
      const date = issue.appDate || issue.rforceDate;
      router.push(`/?date=${date}&view=day`);
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
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-500" />
          <h1 className="text-lg font-semibold">
            Issues{" "}
            <span className="text-muted font-normal text-sm">
              ({allIssues.length})
            </span>
          </h1>
        </div>
        <p className="text-xs text-muted mt-0.5">
          rForce work orders missing from calendar or with schedule mismatches
        </p>
      </header>

      <div className="px-4 py-2 border-b border-border space-y-2 bg-background sticky top-[62px] z-20">
        {/* Search */}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search WO#, name, address…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-2">
          {(
            [
              { key: "all", label: "All", count: allIssues.length },
              { key: "missing", label: "Missing", count: missingCount },
              { key: "mismatch", label: "Mismatch", count: mismatchCount },
            ] as const
          ).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                typeFilter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/15 text-muted hover:bg-muted/25"
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {filteredIssues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted">
            <AlertTriangle size={32} className="mb-2 opacity-30" />
            <p className="text-sm">
              {search || typeFilter !== "all"
                ? "No matching issues found"
                : "No scheduling issues — everything is in sync"}
            </p>
          </div>
        ) : (
          filteredIssues.map((issue) => (
            <IssueRow
              key={`${issue.type}-${issue.woNumber}`}
              issue={issue}
              onClick={() => handleIssueClick(issue)}
            />
          ))
        )}
      </div>
    </div>
  );
}
