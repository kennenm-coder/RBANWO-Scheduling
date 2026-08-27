"use client";

import { useMemo, useState, useCallback } from "react";
import { useData } from "./DataProvider";
import { buildQueueItems } from "@/lib/queue-pipeline";
import { openSalesforce } from "@/lib/salesforce";
import { formatDateStr, formatProductBreakdown } from "@/lib/calendar-utils";
import ScheduleModal from "./ScheduleModal";
import LinkModal from "./LinkModal";
import MergeConfirmModal from "./MergeConfirmModal";
import {
  Appointment,
  RForceOrder,
  QueueItem,
  QueueItemCategory,
} from "@/lib/types";
import {
  filterQueueItems,
  sortQueueItems,
  getCategoryCounts,
  getActiveFilters,
  getUniqueResources,
  DEFAULT_FILTERS,
  QueueFilterState,
  SortOption,
  SORT_OPTIONS,
  DatePreset,
} from "@/lib/queue-filters";
import { getAvailableWoTypes, getWoTypeColor } from "@/lib/wo-type-colors";
import { useQueueFilters } from "@/hooks/useQueueFilters";
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
  Filter,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  ArrowUpDown,
  StickyNote,
  AlertOctagon,
  Info,
  Minus,
  Plus,
} from "lucide-react";
import { useSchedulerDrag } from "@/lib/drag-context";

/** Default queue-tile occupancy by normalized WO type: installs are full-day,
 *  measures default to a 2-hour block, everything else to 1 hour. */
function defaultOccupancy(normalizedWoType: string): { hours: number; fullDay: boolean } {
  if (normalizedWoType === "install" || normalizedWoType === "lswp") return { hours: 8, fullDay: true };
  if (normalizedWoType === "tech_measure") return { hours: 2, fullDay: false };
  return { hours: 1, fullDay: false };
}

// ── Category config (queue-status colors, separate from WO-type colors) ──

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

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "", label: "Any date" },
  { value: "no_date", label: "No date" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "this_week", label: "This week" },
  { value: "next_week", label: "Next week" },
  { value: "overdue", label: "Overdue" },
];

export default function UnscheduledQueue() {
  const {
    rforceOrders,
    appointments,
    unscheduledAppointments,
    crews,
    activeLinks,
    dismissals,
    resourceMappings,
    matchRejections,
    scheduledWorkOrders,
    mergeRForce,
    rejectMatch,
  } = useData();

  const { filters, setFilters, resetFilters, isDefault } = useQueueFilters();
  const [showMore, setShowMore] = useState(false);
  const [scheduleOrder, setScheduleOrder] = useState<RForceOrder | null>(null);
  const [scheduleMeta, setScheduleMeta] = useState<{ hours: number | null; fullDay: boolean } | null>(null);
  const [linkRForceOrder, setLinkRForceOrder] = useState<RForceOrder | null>(null);
  const [linkAppointment, setLinkAppointment] = useState<Appointment | null>(null);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [mergeConfirmItem, setMergeConfirmItem] = useState<QueueItem | null>(null);

  // Build the full unified queue
  const allItems = useMemo(
    () =>
      buildQueueItems(
        rforceOrders,
        appointments,
        unscheduledAppointments,
        crews,
        activeLinks,
        dismissals,
        resourceMappings,
        matchRejections,
        scheduledWorkOrders
      ),
    [rforceOrders, appointments, unscheduledAppointments, crews, activeLinks, dismissals, resourceMappings, matchRejections, scheduledWorkOrders]
  );

  // Dynamic filter options derived from data
  const woTypeOptions = useMemo(() => getAvailableWoTypes(allItems), [allItems]);
  const resourceOptions = useMemo(() => getUniqueResources(allItems), [allItems]);

  // Apply filters + sort
  const filtered = useMemo(() => {
    const f = filterQueueItems(allItems, filters);
    return sortQueueItems(f, filters.sortBy, filters.sortDir);
  }, [allItems, filters]);

  // Category counts (respects other filters, not category itself)
  const categoryCounts = useMemo(() => getCategoryCounts(allItems, filters), [allItems, filters]);

  // Active filter chips
  const activeFilters = useMemo(
    () => getActiveFilters(filters, setFilters),
    [filters, setFilters]
  );

  const handleMergeClick = (item: QueueItem) => {
    if (!item.fuzzyMatch || !item.rforceOrder) return;
    setMergeConfirmItem(item);
  };

  const handleMergeConfirm = async () => {
    if (!mergeConfirmItem?.fuzzyMatch || !mergeConfirmItem?.rforceOrder) return;
    setMergingId(mergeConfirmItem.id);
    try {
      await mergeRForce(mergeConfirmItem.fuzzyMatch.appointment, mergeConfirmItem.rforceOrder);
    } catch (err) {
      console.error("Merge failed:", err);
    } finally {
      setMergingId(null);
      setMergeConfirmItem(null);
    }
  };

  const updateFilter = useCallback(
    <K extends keyof QueueFilterState>(key: K, value: QueueFilterState[K]) => {
      setFilters((f) => ({ ...f, [key]: value }));
    },
    [setFilters]
  );

  const toggleWoType = useCallback(
    (type: string) => {
      setFilters((f) => ({
        ...f,
        woTypes: f.woTypes.includes(type)
          ? f.woTypes.filter((t) => t !== type)
          : [...f.woTypes, type],
      }));
    },
    [setFilters]
  );

  const toggleCategory = useCallback(
    (cat: QueueItemCategory) => {
      setFilters((f) => ({
        ...f,
        categories: f.categories.includes(cat)
          ? f.categories.filter((c) => c !== cat)
          : [...f.categories, cat],
      }));
    },
    [setFilters]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Search bar ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5 flex-1 bg-surface border border-border rounded-lg px-2.5 py-1.5">
          <Search size={13} className="text-muted shrink-0" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            placeholder="Search name, WO#, address, city, ZIP, resource..."
            className="bg-transparent text-xs outline-none w-full"
          />
          {filters.search && (
            <button onClick={() => updateFilter("search", "")} className="p-0.5 text-muted hover:text-foreground">
              <X size={10} />
            </button>
          )}
        </div>
        {/* Sort */}
        <select
          value={filters.sortBy}
          onChange={(e) => updateFilter("sortBy", e.target.value as SortOption)}
          className="bg-surface border border-border rounded-md px-1.5 py-1 text-[10px] text-muted outline-none"
          title="Sort by"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Primary filter row ── */}
      <div className="px-3 py-1.5 border-b border-border space-y-1.5">
        {/* WO type chips */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          <span className="text-[9px] text-muted font-medium shrink-0 mr-0.5">Type:</span>
          {woTypeOptions.map((wt) => {
            const color = getWoTypeColor(wt.value);
            const active = filters.woTypes.includes(wt.value);
            return (
              <button
                key={wt.value}
                onClick={() => toggleWoType(wt.value)}
                className={`px-2 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap transition-all border ${
                  active
                    ? `${color.bg} ${color.text} border-current`
                    : "bg-surface text-muted border-transparent hover:border-border"
                }`}
              >
                {wt.label} ({wt.count})
              </button>
            );
          })}
        </div>

        {/* Queue status chips */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          <span className="text-[9px] text-muted font-medium shrink-0 mr-0.5">Status:</span>
          {(Object.keys(CATEGORY_CONFIG) as QueueItemCategory[]).map((key) => {
            const count = categoryCounts[key] || 0;
            const cfg = CATEGORY_CONFIG[key];
            const active = filters.categories.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleCategory(key)}
                className={`px-2 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap transition-all border ${
                  active
                    ? `${cfg.bg} ${cfg.color} border-current`
                    : "bg-surface text-muted border-transparent hover:border-border"
                }`}
              >
                {cfg.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Secondary row: resource, date, more */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Resource select */}
          <select
            value={filters.assignedResource}
            onChange={(e) => updateFilter("assignedResource", e.target.value)}
            className="bg-surface border border-border rounded-md px-1.5 py-0.5 text-[10px] text-muted outline-none max-w-[130px]"
          >
            <option value="">Any resource</option>
            <option value="__unassigned__">Unassigned</option>
            {resourceOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          {/* Date preset */}
          <select
            value={filters.datePreset}
            onChange={(e) => updateFilter("datePreset", e.target.value as DatePreset)}
            className="bg-surface border border-border rounded-md px-1.5 py-0.5 text-[10px] text-muted outline-none"
          >
            {DATE_PRESETS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>

          {/* More filters button */}
          <button
            onClick={() => setShowMore(!showMore)}
            className={`flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
              showMore ? "bg-primary/10 text-primary" : "bg-surface text-muted hover:bg-border"
            }`}
          >
            <SlidersHorizontal size={9} />
            More
            {showMore ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
          </button>

          {/* Clear all */}
          {!isDefault && (
            <button
              onClick={resetFilters}
              className="ml-auto text-[10px] text-red-500 hover:text-red-600 font-medium"
            >
              Clear all
            </button>
          )}
        </div>

        {/* ── Expanded filters panel ── */}
        {showMore && (
          <div className="pt-1.5 pb-0.5 border-t border-border/50 space-y-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* City */}
              <div className="flex items-center gap-1 bg-surface border border-border rounded-md px-1.5 py-0.5">
                <MapPin size={9} className="text-muted shrink-0" />
                <input
                  type="text"
                  value={filters.city}
                  onChange={(e) => updateFilter("city", e.target.value)}
                  placeholder="City"
                  className="bg-transparent text-[10px] outline-none w-[70px]"
                />
              </div>

              {/* ZIP */}
              <div className="flex items-center gap-1 bg-surface border border-border rounded-md px-1.5 py-0.5">
                <span className="text-[9px] text-muted">#</span>
                <input
                  type="text"
                  value={filters.zip}
                  onChange={(e) => updateFilter("zip", e.target.value)}
                  placeholder="ZIP"
                  className="bg-transparent text-[10px] outline-none w-[50px]"
                />
              </div>

              {/* Product count min/max */}
              <div className="flex items-center gap-0.5">
                <Package size={9} className="text-muted" />
                <input
                  type="number"
                  min={0}
                  value={filters.productCountMin ?? ""}
                  onChange={(e) => updateFilter("productCountMin", e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="Min"
                  className="bg-surface border border-border rounded-md px-1 py-0.5 text-[10px] outline-none w-[40px]"
                />
                <span className="text-[9px] text-muted">–</span>
                <input
                  type="number"
                  min={0}
                  value={filters.productCountMax ?? ""}
                  onChange={(e) => updateFilter("productCountMax", e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="Max"
                  className="bg-surface border border-border rounded-md px-1 py-0.5 text-[10px] outline-none w-[40px]"
                />
              </div>
            </div>

            {/* Quick toggles */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <QuickToggle
                label="Has alerts"
                icon={<AlertOctagon size={9} />}
                active={filters.hasAlerts === true}
                onClick={() => updateFilter("hasAlerts", filters.hasAlerts === true ? null : true)}
              />
              <QuickToggle
                label="Has notes"
                icon={<StickyNote size={9} />}
                active={filters.hasSchedulerNotes === true}
                onClick={() => updateFilter("hasSchedulerNotes", filters.hasSchedulerNotes === true ? null : true)}
              />
              <QuickToggle
                label="Possible merge"
                icon={<GitMerge size={9} />}
                active={filters.hasPossibleMerge === true}
                onClick={() => updateFilter("hasPossibleMerge", filters.hasPossibleMerge === true ? null : true)}
              />
              <QuickToggle
                label="Missing info"
                icon={<Info size={9} />}
                active={filters.hasMissingInfo === true}
                onClick={() => updateFilter("hasMissingInfo", filters.hasMissingInfo === true ? null : true)}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Active filters + result count ── */}
      {(activeFilters.length > 0 || !isDefault) && (
        <div className="px-3 py-1 border-b border-border/50 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold text-foreground shrink-0">
            Showing {filtered.length} of {allItems.length}
          </span>
          {activeFilters.map((af) => (
            <span
              key={af.key}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-medium"
            >
              {af.label}
              <button onClick={af.onRemove} className="hover:text-red-500 ml-0.5">
                <X size={8} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Queue items ── */}
      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted text-sm space-y-2">
            <div>No items match these filters.</div>
            {!isDefault && (
              <button
                onClick={resetFilters}
                className="text-primary text-xs underline hover:no-underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
        {filtered.map((item) => (
          <QueueItemCard
            key={item.id}
            item={item}
            rforceOrders={rforceOrders}
            appointments={appointments}
            merging={mergingId === item.id}
            onSchedule={(rf, meta) => { setScheduleOrder(rf); setScheduleMeta(meta); }}
            onLinkRForce={(rf) => setLinkRForceOrder(rf)}
            onLinkApp={(appt) => setLinkAppointment(appt)}
            onMerge={() => handleMergeClick(item)}
            onRejectMatch={
              item.category === "merge_suggested" && item.fuzzyMatch && item.workOrderNumber
                ? () => rejectMatch(item.fuzzyMatch!.appointment.id, item.workOrderNumber!)
                : undefined
            }
          />
        ))}
      </div>

      {/* ── Modals ── */}
      {scheduleOrder && (
        <ScheduleModal
          date={new Date()}
          prefill={scheduleOrder}
          initialResourceHours={scheduleMeta?.fullDay ? null : scheduleMeta?.hours ?? null}
          initialIsFullDay={scheduleMeta?.fullDay}
          onClose={() => { setScheduleOrder(null); setScheduleMeta(null); }}
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
      {mergeConfirmItem?.fuzzyMatch && mergeConfirmItem?.rforceOrder && (
        <MergeConfirmModal
          appointment={mergeConfirmItem.fuzzyMatch.appointment}
          rforceOrder={mergeConfirmItem.rforceOrder}
          fuzzyMatch={mergeConfirmItem.fuzzyMatch}
          onConfirm={handleMergeConfirm}
          onReject={() => {
            if (mergeConfirmItem.fuzzyMatch && mergeConfirmItem.workOrderNumber) {
              rejectMatch(mergeConfirmItem.fuzzyMatch.appointment.id, mergeConfirmItem.workOrderNumber);
            }
          }}
          onClose={() => setMergeConfirmItem(null)}
        />
      )}
    </div>
  );
}

// ── Quick Toggle Chip ──

function QuickToggle({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-medium transition-all border ${
        active
          ? "bg-primary/10 text-primary border-primary/30"
          : "bg-surface text-muted border-transparent hover:border-border"
      }`}
    >
      {icon}
      {label}
    </button>
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
  onRejectMatch,
}: {
  item: QueueItem;
  rforceOrders: RForceOrder[];
  appointments: Appointment[];
  merging: boolean;
  onSchedule: (rf: RForceOrder, meta: { hours: number | null; fullDay: boolean }) => void;
  onLinkRForce: (rf: RForceOrder) => void;
  onLinkApp: (appt: Appointment) => void;
  onMerge: () => void;
  onRejectMatch?: () => void;
}) {
  const { setDraggedOrder, setDraggedMeta } = useSchedulerDrag();
  const cfg = CATEGORY_CONFIG[item.category];
  const Icon = cfg.icon;
  const woColor = getWoTypeColor(item.normalizedWoType);

  const isDraggable =
    item.category === "unscheduled" ||
    item.category === "needs_confirmation" ||
    item.category === "app_unscheduled";

  const isMerge = item.category === "merge_suggested";

  // Occupancy the scheduler sets on the tile before placing it. Measures default
  // to a 2h block, installs to full-day, everyone else to 1h. The value rides
  // along on drop and on the Schedule button so the calendar sizes the job.
  const isMeasure = item.normalizedWoType === "tech_measure";
  const occDefault = defaultOccupancy(item.normalizedWoType);
  const [hours, setHours] = useState(occDefault.hours);
  const [fullDay, setFullDay] = useState(occDefault.fullDay);
  const occMeta = { hours: fullDay ? null : hours, fullDay };

  return (
    <div
      draggable={isDraggable}
      onDragStart={(e) => {
        const rf = item.rforceOrder || rforceOrders.find((r) => r.work_order_number === item.workOrderNumber);
        if (rf) {
          setDraggedOrder(rf);
          setDraggedMeta(occMeta);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item.workOrderNumber || item.id);
          (e.currentTarget as HTMLElement).style.opacity = "0.5";
        }
      }}
      onDragEnd={(e) => {
        setDraggedOrder(null);
        (e.currentTarget as HTMLElement).style.opacity = "1";
      }}
      className={`rounded-lg border bg-background shadow-sm hover:shadow-md transition-all overflow-hidden border-l-[3px] ${
        woColor.border
      } ${
        isDraggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${
        isMerge
          ? "border-r-green-500/50 border-t-green-500/50 border-b-green-500/50 dark:border-r-green-400/30 dark:border-t-green-400/30 dark:border-b-green-400/30"
          : "border-r-border border-t-border border-b-border"
      }`}
    >
      <div className="flex items-stretch">
        {isDraggable && (
          <div className="w-6 shrink-0 flex items-center justify-center bg-surface/50 border-r border-border/50 text-muted/40">
            <GripVertical size={12} />
          </div>
        )}

        <div className="flex-1 min-w-0 p-2.5">
          {/* Row 1: Name + badges */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="font-semibold text-sm truncate flex-1">
              {item.customerName || "Unknown"}
            </span>
            {/* WO type badge */}
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0 ${woColor.bg} ${woColor.text}`}
              title={item.sourceWoType || item.normalizedWoType}
            >
              {woColor.label}
            </span>
            {/* Queue status badge */}
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

          {/* Row 2: City + ZIP + date + resource */}
          <div className="flex items-center gap-2 text-xs text-muted mb-1 flex-wrap">
            {item.city && (
              <span className="flex items-center gap-0.5 truncate">
                <MapPin size={10} className="shrink-0" />
                {item.city}
                {item.zip && <span className="text-muted/60">{item.zip}</span>}
              </span>
            )}
            {item.effectiveDate && (
              <span className="flex items-center gap-0.5 shrink-0">
                <Calendar size={10} className="shrink-0" />
                {formatDateStr(item.effectiveDate)}
              </span>
            )}
            {item.assignedResource && (
              <span className="font-medium text-foreground/70 truncate max-w-[120px]" title={item.assignedResource}>
                {item.assignedResource}
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
            {item.orderNumber && (
              <span className="text-[10px] text-muted bg-surface px-1.5 py-0.5 rounded">
                Order: {item.orderNumber}
              </span>
            )}
            {(() => {
              const productLabel = formatProductBreakdown({
                product_count: item.productCount,
                windows: item.windows,
                patio_doors: item.patioDoors,
                doors: item.doors,
              });
              return productLabel ? (
                <span className="text-[10px] text-muted bg-surface px-1.5 py-0.5 rounded flex items-center gap-0.5">
                  <Package size={8} />
                  {productLabel}
                </span>
              ) : null;
            })()}
            {item.hasAlerts && (
              <span className="text-[10px] bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded flex items-center gap-0.5" title={item.rforceOrder?.order_alerts || ""}>
                <AlertOctagon size={8} />
                Alert
              </span>
            )}
            {item.hasSchedulerNotes && (
              <span className="text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded flex items-center gap-0.5" title={item.schedulerNotes || ""}>
                <StickyNote size={8} />
                Note
              </span>
            )}
            {item.hasMissingInfo && (
              <span className="text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <Info size={8} />
                Missing info
              </span>
            )}
          </div>

          {/* Row 3.5: Occupancy (hours stepper + full-day) for schedulable tiles */}
          {isDraggable && (
            <div
              className="flex items-center gap-2 mt-2 text-[11px]"
              onClick={(e) => e.stopPropagation()}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
            >
              {!fullDay && (
                <div className="flex items-center gap-1">
                  <span className="text-muted">Hrs</span>
                  <button
                    type="button"
                    onClick={() => setHours((h) => Math.max(0.5, Math.round((h - 0.5) * 2) / 2))}
                    className="w-5 h-5 rounded border border-border hover:bg-surface flex items-center justify-center text-muted"
                    aria-label="Decrease hours"
                  >
                    <Minus size={10} />
                  </button>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={hours}
                    onChange={(e) => setHours(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                    className="w-10 text-center border border-border rounded bg-background py-0.5"
                  />
                  <button
                    type="button"
                    onClick={() => setHours((h) => Math.round((h + 0.5) * 2) / 2)}
                    className="w-5 h-5 rounded border border-border hover:bg-surface flex items-center justify-center text-muted"
                    aria-label="Increase hours"
                  >
                    <Plus size={10} />
                  </button>
                </div>
              )}
              {!isMeasure && (
                <label className="flex items-center gap-1 cursor-pointer select-none ml-auto">
                  <input
                    type="checkbox"
                    checked={fullDay}
                    onChange={(e) => setFullDay(e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="text-muted">Full day</span>
                </label>
              )}
            </div>
          )}

          {/* Row 4: Actions */}
          <div className="flex items-center gap-1.5 mt-2">
            {isMerge && (
              <>
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
                {onRejectMatch && (
                  <button
                    onClick={onRejectMatch}
                    className="px-2 py-1 border border-border text-[11px] rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-muted hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center gap-0.5"
                    title="Not a match — won't suggest again"
                  >
                    <XCircle size={10} />
                    Not a match
                  </button>
                )}
              </>
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
                    if (rf) onSchedule(rf, occMeta);
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
