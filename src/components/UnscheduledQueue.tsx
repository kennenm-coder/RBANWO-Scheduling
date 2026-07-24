"use client";

import { useState } from "react";
import { useData } from "./DataProvider";
import { reconcile } from "@/lib/reconcile";
import { openSalesforce, mapsHref } from "@/lib/salesforce";
import ScheduleModal from "./ScheduleModal";
import {
  RForceOrder,
  ReconciliationResult,
  ReconciliationStatus,
} from "@/lib/types";
import {
  Calendar,
  ExternalLink,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";

const STATUS_CONFIG: Record<
  ReconciliationStatus,
  { label: string; color: string; icon: typeof Clock }
> = {
  unscheduled: {
    label: "Unscheduled",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200",
    icon: Clock,
  },
  scheduled_app_only: {
    label: "App Only",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
    icon: Calendar,
  },
  scheduled_both: {
    label: "Synced",
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
    icon: CheckCircle2,
  },
  discrepancy: {
    label: "Mismatch",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
    icon: AlertTriangle,
  },
  not_in_rforce: {
    label: "Not in rForce",
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200",
    icon: XCircle,
  },
};

export default function UnscheduledQueue() {
  const { rforceOrders, appointments, crews } = useData();
  const [filter, setFilter] = useState<ReconciliationStatus | "all">("unscheduled");
  const [scheduleOrder, setScheduleOrder] = useState<RForceOrder | null>(null);

  const results = reconcile(rforceOrders, appointments, crews);

  const filtered =
    filter === "all"
      ? results
      : results.filter((r) => r.status === filter);

  const counts = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex gap-1 px-4 py-3 overflow-x-auto border-b border-border">
        <FilterChip
          label={`All (${results.length})`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {(Object.entries(STATUS_CONFIG) as [ReconciliationStatus, typeof STATUS_CONFIG[ReconciliationStatus]][]).map(
          ([key, cfg]) => (
            <FilterChip
              key={key}
              label={`${cfg.label} (${counts[key] || 0})`}
              active={filter === key}
              onClick={() => setFilter(key)}
            />
          )
        )}
      </div>

      <div className="divide-y divide-border">
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted text-sm">
            No items match this filter.
          </div>
        )}
        {filtered.map((item) => {
          const cfg = STATUS_CONFIG[item.status];
          const Icon = cfg.icon;
          return (
            <div
              key={item.workOrderNumber}
              className="px-4 py-3 hover:bg-surface"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {item.customerName || "Unknown"}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}
                    >
                      <Icon size={10} />
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
                    <MapPin size={10} />
                    <span className="truncate">{item.address}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted mt-1">
                    <span>WO: {item.workOrderNumber}</span>
                    {item.appDate && (
                      <span>App: {item.appDate}</span>
                    )}
                    {item.rforceDate && (
                      <span>rForce: {item.rforceDate}</span>
                    )}
                    {item.appCrew && (
                      <span>Crew: {item.appCrew}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  {item.status === "unscheduled" && (
                    <button
                      onClick={() => {
                        const rf = rforceOrders.find(
                          (r) =>
                            r.work_order_number === item.workOrderNumber
                        );
                        if (rf) setScheduleOrder(rf);
                      }}
                      className="px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:opacity-90"
                    >
                      Schedule
                    </button>
                  )}
                  <button
                    onClick={() =>
                      openSalesforce(
                        item.workOrderNumber,
                        item.orderNumber
                      )
                    }
                    className="p-1.5 rounded-lg hover:bg-surface text-muted"
                    title="Open in rForce"
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {scheduleOrder && (
        <ScheduleModal
          date={new Date()}
          prefill={scheduleOrder}
          onClose={() => setScheduleOrder(null)}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
        active
          ? "bg-primary text-white"
          : "bg-surface text-muted hover:bg-border"
      }`}
    >
      {label}
    </button>
  );
}
