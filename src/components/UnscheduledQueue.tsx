"use client";

import { useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { buildQueueItems } from "@/lib/queue-pipeline";
import { openSalesforce } from "@/lib/salesforce";
import ScheduleModal from "./ScheduleModal";
import LinkModal from "./LinkModal";
import {
  Appointment,
  RForceOrder,
  QueueItem,
  QueueItemCategory,
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
  GitMerge,
  Undo2,
  Loader2,
} from "lucide-react";
import { setDraggedOrder } from "@/lib/drag-context";

const CATEGORY_CONFIG: Record<
  QueueItemCategory,
  { label: string; color: string; bg: string; icon: typeof Clock }
> = {
  merge_suggested: {
    label: "Merge",
    color: "text-green-700 dark:text-green-300",
    bg: "bg-green-100 dark:bg-green-900/30",
    icon: GitMerge,
  },
  needs_confirmation: {
    label: "Confirm",
    color: "text-orange-700 dark:text-orange-300",
    bg: "bg-orange-100 dark:bg-orange-900/30",
    icon: AlertTriangle,
  },
  app_unscheduled: {
    label: "Returned",
    color: "text-blue-700 dark:text-blue-300",
    bg: "bg-blue-100 dark:bg-blue-900/30",
    icon: Undo2,
  },
  unscheduled: {
    label: "Unscheduled",
    color: "text-yellow-700 dark:text-yellow-300",
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    icon: Clock,
  },
  discrepancy: {
    label: "Mismatch",
    color: "text-red-700 dark:text-red-300",
    bg: "bg-red-100 dark:bg-red-900/30",
    icon: AlertTriangle,
  },
  not_in_rforce: {
    label: "Not in rForce",
    color: "text-purple-700 dark:text-purple-300",
    bg: "bg-purple-100 dark:bg-purple-900/30",
    icon: XCircle,
  },
};

export default function UnscheduledQueue() {
  const {
    rforceOrders,
    appointments,
    unscheduledAppointments,
    crews,
    activeLinks,
    dismissals,
    resourceMappings,
    mergeRForce,
  } = useData();
  const [filter, setFilter] = useState<QueueItemCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [scheduleOrder, setScheduleOrder] = useState<RForceOrder | null>(null);
  const [linkRForceOrder, setLinkRForceOrder] = useState<RForceOrder | null>(null);
  const [linkAppointment, setLinkAppointment] = useState<Appointment | null>(null);
  const [mergingId, setMergingId] = useState<string | null>(null);

  const allItems = useMemo(
    () =>
      buildQueueItems(
        rforceOrders,
        appointments,
        unscheduledAppointments,
        crews,
        activeLinks,
        dismissals,
        resourceMappings
      ),
    [rforceOrders, appointments, unscheduledAppointments, crews, activeLinks, dismissals, resourceMappings]
  );

  const preFiltered =
    filter === "all" ? allItems : allItems.filter((i) => i.category === filter);

  const filtered = searchQuery.trim()
    ? preFiltered.filter((i) => {
        const q = searchQuery.toLowerCase();
        return (
          i.customerName?.toLowerCase().includes(q) ||
          i.workOrderNumber?.toLowerCase().includes(q) ||
          i.orderNumber?.toLowerCase().includes(q) ||
          i.address?.toLowerCase().includes(q) ||
          i.workOrderType?.toLowerCase().includes(q)
        );
      })
    : preFiltered;

  const counts = allItems.reduce(
    (acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const handleMerge = async (item: QueueItem) => {
    if (!item.fuzzyMatch || !item.rforceOrder) return;
    setMergingId(item.id);
    try {
      await mergeRForce(item.fuzzyMatch.appointment, item.rforceOrder);
    } catch (err) {
      console.error("Merge failed:", err);
    } finally {
      setMergingId(null);
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      {/* Search bar */}
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

      {/* Filter chips */}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto border-b border-border">
        <FilterChip
          label={`All (${allItems.length})`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {(Object.keys(CATEGORY_CONFIG) as QueueItemCategory[]).map((key) => {
          const count = counts[key] || 0;
          if (count === 0) return null;
          const cfg = CATEGORY_CONFIG[key];
          return (
            <FilterChip
              key={key}
              label={`${cfg.label} (${count})`}
              active={filter === key}
              onClick={() => setFilter(key)}
            />
          );
        })}
      </div>

      {/* Items */}
      <div className="p-2 space-y-1.5">
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted text-sm">
            No items match this filter.
          </div>
        )}
        {filtered.map((item) => (
          <QueueItemCard
            key={item.id}
            item={item}
            rforceOrders={rforceOrders}
            appointments={appointments}
            merging={mergingId === item.id}
            onSchedule={(rf) => setScheduleOrder(rf)}
            onLinkRForce={(rf) => setLinkRForceOrder(rf)}
            onLinkApp={(appt) => setLinkAppointment(appt)}
            onMerge={() => handleMerge(item)}
          />
        ))}
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

// ── Queue Item Card ──

function QueueItemCard({
  item,
  rforceOrders,
  appointments,
  merging,
  onSchedule,
  onLinkRForce,
  onLinkApp,
  onMerge,
}: {
  item: QueueItem;
  rforceOrders: RForceOrder[];
  appointments: Appointment[];
  merging: boolean;
  onSchedule: (rf: RForceOrder) => void;
  onLinkRForce: (rf: RForceOrder) => void;
  onLinkApp: (appt: Appointment) => void;
  onMerge: () => void;
}) {
  const cfg = CATEGORY_CONFIG[item.category];
  const Icon = cfg.icon;
  const city = parseCity(item.address || "");

  const isDraggable =
    item.category === "unscheduled" ||
    item.category === "needs_confirmation" ||
    item.category === "app_unscheduled";

  const isMerge = item.category === "merge_suggested";

  return (
    <div
      draggable={isDraggable}
      onDragStart={(e) => {
        const rf = item.rforceOrder || rforceOrders.find((r) => r.work_order_number === item.workOrderNumber);
        if (rf) {
          setDraggedOrder(rf);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item.workOrderNumber || item.id);
          (e.currentTarget as HTMLElement).style.opacity = "0.5";
        }
      }}
      onDragEnd={(e) => {
        setDraggedOrder(null);
        (e.currentTarget as HTMLElement).style.opacity = "1";
      }}
      className={`rounded-lg border bg-background shadow-sm hover:shadow-md transition-all overflow-hidden ${
        isDraggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${
        isMerge
          ? "border-green-500/50 dark:border-green-400/30"
          : "border-border"
      }`}
    >
      <div className="flex items-stretch">
        {isDraggable && (
          <div className="w-6 shrink-0 flex items-center justify-center bg-surface/50 border-r border-border/50 text-muted/40">
            <GripVertical size={12} />
          </div>
        )}

        <div className="flex-1 min-w-0 p-2.5">
          {/* Row 1: Name + badge */}
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
            {item.fuzzyMatch && (
              <span
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${
                  item.fuzzyMatch.confidence === "high"
                    ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                    : "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300"
                }`}
              >
                {item.fuzzyMatch.confidence === "high" ? "HIGH" : "MED"}
              </span>
            )}
          </div>

          {/* Row 2: City + type */}
          <div className="flex items-center gap-2 text-xs text-muted mb-1">
            {city && (
              <span className="flex items-center gap-0.5 truncate">
                <MapPin size={10} className="shrink-0" />
                {city}
              </span>
            )}
            {item.workOrderType && (
              <span className="font-medium text-foreground/70 shrink-0">
                {item.workOrderType}
              </span>
            )}
          </div>

          {/* Merge match info */}
          {isMerge && item.fuzzyMatch && (
            <div className="mb-1.5 px-2 py-1.5 rounded bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 text-[10px]">
              <div className="font-medium text-green-700 dark:text-green-300 mb-0.5">
                Possible match: {item.fuzzyMatch.appointment.customer_name}
              </div>
              <div className="text-green-600 dark:text-green-400">
                {item.fuzzyMatch.matchReasons.join(" · ")}
              </div>
            </div>
          )}

          {/* Row 3: Meta chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.workOrderNumber && (
              <span className="text-[10px] text-muted bg-surface px-1.5 py-0.5 rounded">
                WO: {item.workOrderNumber}
              </span>
            )}
            {item.productCount != null && item.productCount > 0 && (
              <span className="text-[10px] text-muted bg-surface px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <Package size={8} />
                {item.productCount}
              </span>
            )}
          </div>

          {/* Row 4: Actions */}
          <div className="flex items-center gap-1.5 mt-2">
            {isMerge && (
              <button
                onClick={onMerge}
                disabled={merging}
                className="px-2.5 py-1 bg-green-600 text-white text-[11px] font-medium rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {merging ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <GitMerge size={10} />
                )}
                Merge
              </button>
            )}
            {(item.category === "unscheduled" ||
              item.category === "needs_confirmation" ||
              item.category === "app_unscheduled") && (
              <>
                <button
                  onClick={() => {
                    const rf =
                      item.rforceOrder ||
                      rforceOrders.find(
                        (r) => r.work_order_number === item.workOrderNumber
                      );
                    if (rf) onSchedule(rf);
                  }}
                  className="px-2.5 py-1 bg-primary text-white text-[11px] font-medium rounded-md hover:opacity-90 transition-opacity"
                >
                  Schedule
                </button>
                {item.rforceOrder && (
                  <button
                    onClick={() => {
                      if (item.rforceOrder) onLinkRForce(item.rforceOrder);
                    }}
                    className="px-2 py-1 border border-border text-[11px] rounded-md hover:bg-surface flex items-center gap-0.5 transition-colors"
                    title="Link to existing app appointment"
                  >
                    <Link2 size={10} />
                    Link
                  </button>
                )}
              </>
            )}
            {item.category === "not_in_rforce" && (
              <button
                onClick={() => {
                  const appt = appointments.find(
                    (a) =>
                      a.work_order_number === item.workOrderNumber ||
                      (!a.work_order_number &&
                        a.customer_name === item.customerName &&
                        a.status !== "cancelled")
                  );
                  if (appt) onLinkApp(appt);
                }}
                className="px-2 py-1 border border-border text-[11px] rounded-md hover:bg-surface flex items-center gap-0.5 transition-colors"
                title="Link to rForce record"
              >
                <Link2 size={10} />
                Link
              </button>
            )}
            {item.workOrderNumber && (
              <button
                onClick={() =>
                  openSalesforce(item.workOrderNumber!, item.orderNumber || "")
                }
                className="ml-auto p-1 rounded-md hover:bg-surface text-muted transition-colors"
                title="Open in rForce"
              >
                <ExternalLink size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Filter Chip ──

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
