"use client";

import { useState } from "react";
import { useData } from "./DataProvider";
import { reconcile } from "@/lib/reconcile";
import { openSalesforce } from "@/lib/salesforce";
import ScheduleModal from "./ScheduleModal";
import LinkModal from "./LinkModal";
import {
  Appointment,
  RForceOrder,
  ReconciliationResult,
  ReconciliationStatus,
} from "@/lib/types";
import { parseCity } from "@/lib/crew-utils";
import {
  Calendar,
  ExternalLink,
  Link2,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Search,
  X,
  GripVertical,
  Package,
  ArrowRightLeft,
} from "lucide-react";
import { setDraggedOrder } from "@/lib/drag-context";

const STATUS_CONFIG: Record<
  ReconciliationStatus,
  { label: string; color: string; bg: string; icon: typeof Clock; hidden?: boolean }
> = {
  unscheduled: {
    label: "Unscheduled",
    color: "text-yellow-700 dark:text-yellow-300",
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    icon: Clock,
  },
  scheduled_rforce_only: {
    label: "rForce Only",
    color: "text-orange-700 dark:text-orange-300",
    bg: "bg-orange-100 dark:bg-orange-900/30",
    icon: AlertTriangle,
  },
  scheduled_app_only: {
    label: "App Only",
    color: "text-blue-700 dark:text-blue-300",
    bg: "bg-blue-100 dark:bg-blue-900/30",
    icon: Calendar,
  },
  scheduled_both: {
    label: "Synced",
    color: "text-green-700 dark:text-green-300",
    bg: "bg-green-100 dark:bg-green-900/30",
    icon: CheckCircle2,
  },
  discrepancy: {
    label: "Mismatch",
    color: "text-red-700 dark:text-red-300",
    bg: "bg-red-100 dark:bg-red-900/30",
    icon: AlertTriangle,
  },
  manual_override: {
    label: "Override",
    color: "text-blue-700 dark:text-blue-300",
    bg: "bg-blue-100 dark:bg-blue-900/30",
    icon: ArrowRightLeft,
  },
  not_in_rforce: {
    label: "Not in rForce",
    color: "text-purple-700 dark:text-purple-300",
    bg: "bg-purple-100 dark:bg-purple-900/30",
    icon: XCircle,
  },
  completed: {
    label: "Completed",
    color: "text-gray-500 dark:text-gray-400",
    bg: "bg-gray-100 dark:bg-gray-900/30",
    icon: CheckCircle2,
    hidden: true,
  },
  cancelled: {
    label: "Cancelled",
    color: "text-gray-400 dark:text-gray-500",
    bg: "bg-gray-100 dark:bg-gray-900/30",
    icon: XCircle,
    hidden: true,
  },
};

export default function UnscheduledQueue() {
  const { rforceOrders, appointments, crews } = useData();
  const [filter, setFilter] = useState<ReconciliationStatus | "all">("unscheduled");
  const [searchQuery, setSearchQuery] = useState("");
  const [scheduleOrder, setScheduleOrder] = useState<RForceOrder | null>(null);
  const [linkRForceOrder, setLinkRForceOrder] = useState<RForceOrder | null>(null);
  const [linkAppointment, setLinkAppointment] = useState<Appointment | null>(null);

  const allResults = reconcile(rforceOrders, appointments, crews);

  const activeResults = allResults.filter(
    (r) => !STATUS_CONFIG[r.status].hidden
  );

  const preFiltered =
    filter === "all"
      ? activeResults
      : allResults.filter((r) => r.status === filter);

  const filtered = searchQuery.trim()
    ? preFiltered.filter((r) => {
        const q = searchQuery.toLowerCase();
        return (
          r.customerName?.toLowerCase().includes(q) ||
          r.workOrderNumber?.toLowerCase().includes(q) ||
          r.orderNumber?.toLowerCase().includes(q) ||
          r.address?.toLowerCase().includes(q) ||
          r.workOrderType?.toLowerCase().includes(q) ||
          r.rforceCrew?.toLowerCase().includes(q)
        );
      })
    : preFiltered;

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
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5 flex-1 bg-surface border border-border rounded-lg px-2.5 py-1.5">
          <Search size={13} className="text-muted shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search queue..."
            className="bg-transparent text-xs outline-none w-full"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="p-0.5 text-muted hover:text-foreground">
              <X size={10} />
            </button>
          )}
        </div>
        {searchQuery && (
          <span className="text-[10px] text-muted shrink-0">{filtered.length}</span>
        )}
      </div>
      <div className="flex gap-1 px-3 py-2 overflow-x-auto border-b border-border">
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

      <div className="p-2 space-y-1.5">
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted text-sm">
            No items match this filter.
          </div>
        )}
        {filtered.map((item) => {
          const cfg = STATUS_CONFIG[item.status];
          const Icon = cfg.icon;
          const isDraggable = item.status === "unscheduled" || item.status === "scheduled_rforce_only";
          const city = parseCity(item.address || "");
          const productParts: string[] = [];
          if (item.windows) productParts.push(`${item.windows}W`);
          if (item.patioDoors) productParts.push(`${item.patioDoors}PD`);
          if (item.doors) productParts.push(`${item.doors}D`);

          return (
            <div
              key={item.workOrderNumber}
              draggable={isDraggable}
              onDragStart={(e) => {
                const rf = rforceOrders.find((r) => r.work_order_number === item.workOrderNumber);
                if (rf) {
                  setDraggedOrder(rf);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", item.workOrderNumber);
                  const target = e.currentTarget as HTMLElement;
                  target.style.opacity = "0.5";
                }
              }}
              onDragEnd={(e) => {
                setDraggedOrder(null);
                const target = e.currentTarget as HTMLElement;
                target.style.opacity = "1";
              }}
              className={`rounded-lg border border-border bg-background shadow-sm hover:shadow-md transition-all overflow-hidden ${
                isDraggable ? "cursor-grab active:cursor-grabbing" : ""
              }`}
            >
              {/* Status stripe + drag handle */}
              <div className="flex items-stretch">
                {isDraggable && (
                  <div className="w-6 shrink-0 flex items-center justify-center bg-surface/50 border-r border-border/50 text-muted/40">
                    <GripVertical size={12} />
                  </div>
                )}

                <div className="flex-1 min-w-0 p-2.5">
                  {/* Row 1: Name + status badge */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="font-semibold text-sm truncate flex-1">
                      {item.customerName || "Unknown"}
                    </span>
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0 ${cfg.bg} ${cfg.color}`}
                    >
                      <Icon size={9} />
                      {cfg.label}
                    </span>
                  </div>

                  {/* Row 2: City + WO type */}
                  <div className="flex items-center gap-2 text-xs text-muted mb-1">
                    {city && (
                      <span className="flex items-center gap-0.5 truncate">
                        <MapPin size={10} className="shrink-0" />
                        {city}
                      </span>
                    )}
                    {item.workOrderType && (
                      <span className="font-medium text-foreground/70 shrink-0">{item.workOrderType}</span>
                    )}
                  </div>

                  {/* Row 3: Meta chips */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-muted bg-surface px-1.5 py-0.5 rounded">
                      WO: {item.workOrderNumber}
                    </span>
                    {item.productCount != null && item.productCount > 0 && (
                      <span className="text-[10px] text-muted bg-surface px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <Package size={8} />
                        {item.productCount}
                        {productParts.length > 0 && ` (${productParts.join("/")})`}
                      </span>
                    )}
                    {item.rforceCrew && (
                      <span className="text-[10px] text-muted bg-surface px-1.5 py-0.5 rounded">
                        {item.rforceCrew}
                      </span>
                    )}
                    {item.rforceDate && (
                      <span className="text-[10px] text-muted bg-surface px-1.5 py-0.5 rounded">
                        {item.rforceDate}
                      </span>
                    )}
                  </div>

                  {/* Row 4: Action buttons */}
                  <div className="flex items-center gap-1.5 mt-2">
                    {isDraggable && (
                      <>
                        <button
                          onClick={() => {
                            const rf = rforceOrders.find(
                              (r) => r.work_order_number === item.workOrderNumber
                            );
                            if (rf) setScheduleOrder(rf);
                          }}
                          className="px-2.5 py-1 bg-primary text-white text-[11px] font-medium rounded-md hover:opacity-90 transition-opacity"
                        >
                          Schedule
                        </button>
                        <button
                          onClick={() => {
                            const rf = rforceOrders.find(
                              (r) => r.work_order_number === item.workOrderNumber
                            );
                            if (rf) setLinkRForceOrder(rf);
                          }}
                          className="px-2 py-1 border border-border text-[11px] rounded-md hover:bg-surface flex items-center gap-0.5 transition-colors"
                          title="Link to existing app appointment"
                        >
                          <Link2 size={10} />
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
                        className="px-2 py-1 border border-border text-[11px] rounded-md hover:bg-surface flex items-center gap-0.5 transition-colors"
                        title="Link to rForce record"
                      >
                        <Link2 size={10} />
                        Link
                      </button>
                    )}
                    <button
                      onClick={() =>
                        openSalesforce(item.workOrderNumber, item.orderNumber)
                      }
                      className="ml-auto p-1 rounded-md hover:bg-surface text-muted transition-colors"
                      title="Open in rForce"
                    >
                      <ExternalLink size={12} />
                    </button>
                  </div>
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
      className={`px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors ${
        active
          ? "bg-primary text-white"
          : "bg-surface text-muted hover:bg-border"
      }`}
    >
      {label}
    </button>
  );
}
