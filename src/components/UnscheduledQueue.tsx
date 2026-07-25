"use client";

import { useState } from "react";
import { useData } from "./DataProvider";
import { reconcile } from "@/lib/reconcile";
import { openSalesforce, mapsHref } from "@/lib/salesforce";
import ScheduleModal from "./ScheduleModal";
import LinkModal from "./LinkModal";
import {
  Appointment,
  RForceOrder,
  ReconciliationResult,
  ReconciliationStatus,
} from "@/lib/types";
import {
  Calendar,
  ExternalLink,
  Link2,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";

const STATUS_CONFIG: Record<
  ReconciliationStatus,
  { label: string; color: string; icon: typeof Clock; hidden?: boolean }
> = {
  unscheduled: {
    label: "Unscheduled",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200",
    icon: Clock,
  },
  scheduled_rforce_only: {
    label: "rForce Only",
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
    icon: AlertTriangle,
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
  completed: {
    label: "Completed",
    color: "bg-gray-100 text-gray-500 dark:bg-gray-900/30 dark:text-gray-400",
    icon: CheckCircle2,
    hidden: true,
  },
  cancelled: {
    label: "Cancelled",
    color: "bg-gray-100 text-gray-400 dark:bg-gray-900/30 dark:text-gray-500",
    icon: XCircle,
    hidden: true,
  },
};

export default function UnscheduledQueue() {
  const { rforceOrders, appointments, crews } = useData();
  const [filter, setFilter] = useState<ReconciliationStatus | "all">("unscheduled");
  const [scheduleOrder, setScheduleOrder] = useState<RForceOrder | null>(null);
  const [linkRForceOrder, setLinkRForceOrder] = useState<RForceOrder | null>(null);
  const [linkAppointment, setLinkAppointment] = useState<Appointment | null>(null);

  const allResults = reconcile(rforceOrders, appointments, crews);

  const activeResults = allResults.filter(
    (r) => !STATUS_CONFIG[r.status].hidden
  );

  const filtered =
    filter === "all"
      ? activeResults
      : allResults.filter((r) => r.status === filter);

  const counts = allResults.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const visibleStatuses = (
    Object.entries(STATUS_CONFIG) as [ReconciliationStatus, typeof STATUS_CONFIG[ReconciliationStatus]][]
  ).filter(([, cfg]) => !cfg.hidden);

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex gap-1 px-4 py-3 overflow-x-auto border-b border-border">
        <FilterChip
          label={`All (${activeResults.length})`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {visibleStatuses.map(
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
                  <div className="flex items-center gap-3 text-xs text-muted mt-1 flex-wrap">
                    {item.workOrderType && (
                      <span className="font-medium">{item.workOrderType}</span>
                    )}
                    <span>WO: {item.workOrderNumber}</span>
                    {item.woStatus && (
                      <span className="italic">{item.woStatus}</span>
                    )}
                    {item.productCount != null && item.productCount > 0 && (
                      <span>
                        {item.productCount} products
                        {(() => {
                          const parts: string[] = [];
                          if (item.windows) parts.push(`${item.windows}W`);
                          if (item.patioDoors) parts.push(`${item.patioDoors}PD`);
                          if (item.doors) parts.push(`${item.doors}D`);
                          return parts.length > 0 ? ` (${parts.join("/")})` : "";
                        })()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                    {item.appDate && (
                      <span>App: {item.appDate}</span>
                    )}
                    {item.rforceDate && (
                      <span>rForce: {item.rforceDate}</span>
                    )}
                    {item.appCrew && (
                      <span>Crew: {item.appCrew}</span>
                    )}
                    {item.rforceCrew && (
                      <span>Assigned: {item.rforceCrew}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  {(item.status === "unscheduled" || item.status === "scheduled_rforce_only") && (
                    <>
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
                      <button
                        onClick={() => {
                          const rf = rforceOrders.find(
                            (r) =>
                              r.work_order_number === item.workOrderNumber
                          );
                          if (rf) setLinkRForceOrder(rf);
                        }}
                        className="px-2 py-1.5 border border-border text-xs rounded-lg hover:bg-surface flex items-center gap-1"
                        title="Link to existing app appointment"
                      >
                        <Link2 size={12} />
                        Link
                      </button>
                    </>
                  )}
                  {item.status === "not_in_rforce" && (
                    <button
                      onClick={() => {
                        const appt = appointments.find(
                          (a) =>
                            a.work_order_number === item.workOrderNumber ||
                            (!a.work_order_number &&
                              a.customer_name === item.customerName &&
                              a.status !== "cancelled")
                        );
                        if (appt) setLinkAppointment(appt);
                      }}
                      className="px-2 py-1.5 border border-border text-xs rounded-lg hover:bg-surface flex items-center gap-1"
                      title="Link to rForce record"
                    >
                      <Link2 size={12} />
                      Link
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

      {linkRForceOrder && (
        <LinkModal
          mode="link_to_app"
          rforceOrder={linkRForceOrder}
          onClose={() => setLinkRForceOrder(null)}
        />
      )}

      {linkAppointment && (
        <LinkModal
          mode="link_to_rforce"
          appointment={linkAppointment}
          onClose={() => setLinkAppointment(null)}
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
