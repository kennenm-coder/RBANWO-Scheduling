/**
 * Queue filtering, searching, and sorting logic.
 *
 * A single QueueFilterState drives all filtering across every queue category.
 * Search is case-insensitive, tolerates spaces/hyphens, and matches partial
 * work-order numbers (e.g. "329007" finds "10329007").
 */

import { QueueItem, QueueItemCategory } from "./types";
import { format, startOfWeek, endOfWeek, addWeeks, addDays } from "date-fns";

// ── Filter State ──

export interface QueueFilterState {
  search: string;
  woTypes: string[];               // normalized WO type keys (multi-select)
  categories: QueueItemCategory[]; // queue status categories (multi-select)
  assignedResource: string;        // "" = any, "__unassigned__" = unassigned, or specific name
  datePreset: DatePreset;
  dateRangeStart?: string;         // YYYY-MM-DD for "custom" preset
  dateRangeEnd?: string;
  city: string;
  zip: string;
  productCountMin?: number;
  productCountMax?: number;
  hasAlerts: boolean | null;       // null = any, true = has alerts, false = no alerts
  hasSchedulerNotes: boolean | null;
  hasPossibleMerge: boolean | null;
  hasMissingInfo: boolean | null;
  sortBy: SortOption;
  sortDir: "asc" | "desc";
}

export type DatePreset =
  | ""           // any date
  | "no_date"    // no scheduled date
  | "today"
  | "tomorrow"
  | "this_week"
  | "next_week"
  | "overdue"
  | "custom";

export type SortOption =
  | "default"        // category priority → customer name
  | "oldest"         // effectiveDate asc
  | "newest"         // effectiveDate desc
  | "scheduled_date" // effectiveDate asc (same as oldest but named differently)
  | "customer_name"
  | "city"
  | "wo_type"
  | "product_count"
  | "wo_number";

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "default", label: "Most urgent" },
  { value: "oldest", label: "Oldest first" },
  { value: "newest", label: "Newest first" },
  { value: "scheduled_date", label: "Scheduled date" },
  { value: "customer_name", label: "Customer name" },
  { value: "city", label: "City" },
  { value: "wo_type", label: "Work-order type" },
  { value: "product_count", label: "Product count" },
  { value: "wo_number", label: "Work-order number" },
];

export const DEFAULT_FILTERS: QueueFilterState = {
  search: "",
  woTypes: [],
  categories: [],
  assignedResource: "",
  datePreset: "",
  city: "",
  zip: "",
  hasAlerts: null,
  hasSchedulerNotes: null,
  hasPossibleMerge: null,
  hasMissingInfo: null,
  sortBy: "default",
  sortDir: "asc",
};

export function isDefaultFilters(f: QueueFilterState): boolean {
  return (
    f.search === "" &&
    f.woTypes.length === 0 &&
    f.categories.length === 0 &&
    f.assignedResource === "" &&
    f.datePreset === "" &&
    f.city === "" &&
    f.zip === "" &&
    f.productCountMin == null &&
    f.productCountMax == null &&
    f.hasAlerts === null &&
    f.hasSchedulerNotes === null &&
    f.hasPossibleMerge === null &&
    f.hasMissingInfo === null &&
    f.sortBy === "default" &&
    f.sortDir === "asc"
  );
}

// ── Search ──

/** Strip everything except alphanumerics for fuzzy matching. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Check if any of the searchable fields on a QueueItem match the query.
 * Matches partial WO numbers (e.g. "329007" matches "10329007").
 */
function itemMatchesSearch(item: QueueItem, rawQuery: string): boolean {
  const q = normalize(rawQuery);
  if (!q) return true;

  const fields: (string | null | undefined)[] = [
    item.customerName,
    item.workOrderNumber,
    item.orderNumber,
    item.address,
    item.city,
    item.zip,
    item.assignedResource,
    item.workOrderType,
    item.sourceWoType,
    item.schedulerNotes,
    // Also search rForce fields not on the normalized item
    item.rforceOrder?.primary_resource,
    item.rforceOrder?.tech_measure_name,
    item.rforceOrder?.installer,
    item.rforceOrder?.service_rep,
  ];

  return fields.some((f) => f && normalize(f).includes(q));
}

// ── Date filtering ──

function getDateRange(preset: DatePreset, rangeStart?: string, rangeEnd?: string): { start?: string; end?: string } | "no_date" | null {
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  switch (preset) {
    case "":
      return null; // no date filter
    case "no_date":
      return "no_date";
    case "today":
      return { start: todayStr, end: todayStr };
    case "tomorrow": {
      const tmrw = format(addDays(today, 1), "yyyy-MM-dd");
      return { start: tmrw, end: tmrw };
    }
    case "this_week": {
      const start = format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const end = format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");
      return { start, end };
    }
    case "next_week": {
      const next = addWeeks(today, 1);
      const start = format(startOfWeek(next, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const end = format(endOfWeek(next, { weekStartsOn: 1 }), "yyyy-MM-dd");
      return { start, end };
    }
    case "overdue":
      return { end: format(addDays(today, -1), "yyyy-MM-dd") };
    case "custom":
      return { start: rangeStart, end: rangeEnd };
    default:
      return null;
  }
}

function itemMatchesDate(item: QueueItem, preset: DatePreset, rangeStart?: string, rangeEnd?: string): boolean {
  const range = getDateRange(preset, rangeStart, rangeEnd);
  if (range === null) return true; // no filter
  if (range === "no_date") return !item.effectiveDate;

  const d = item.effectiveDate;
  if (!d) return false; // item has no date but we're filtering by a date range

  if (range.start && d < range.start) return false;
  if (range.end && d > range.end) return false;
  return true;
}

// ── Main filter function ──

export function filterQueueItems(items: QueueItem[], filters: QueueFilterState): QueueItem[] {
  let result = items;

  // Search
  if (filters.search.trim()) {
    result = result.filter((i) => itemMatchesSearch(i, filters.search));
  }

  // WO type multi-select
  if (filters.woTypes.length > 0) {
    const set = new Set(filters.woTypes);
    result = result.filter((i) => set.has(i.normalizedWoType));
  }

  // Category multi-select
  if (filters.categories.length > 0) {
    const set = new Set(filters.categories);
    result = result.filter((i) => set.has(i.category));
  }

  // Assigned resource
  if (filters.assignedResource === "__unassigned__") {
    result = result.filter((i) => !i.assignedResource);
  } else if (filters.assignedResource) {
    const norm = normalize(filters.assignedResource);
    result = result.filter((i) => i.assignedResource && normalize(i.assignedResource).includes(norm));
  }

  // Date preset
  if (filters.datePreset) {
    result = result.filter((i) => itemMatchesDate(i, filters.datePreset, filters.dateRangeStart, filters.dateRangeEnd));
  }

  // City
  if (filters.city.trim()) {
    const nc = normalize(filters.city);
    result = result.filter((i) => normalize(i.city).includes(nc));
  }

  // ZIP
  if (filters.zip.trim()) {
    result = result.filter((i) => i.zip.startsWith(filters.zip.trim()));
  }

  // Product count range
  if (filters.productCountMin != null) {
    result = result.filter((i) => (i.productCount || 0) >= filters.productCountMin!);
  }
  if (filters.productCountMax != null) {
    result = result.filter((i) => (i.productCount || 0) <= filters.productCountMax!);
  }

  // Boolean filters
  if (filters.hasAlerts === true) {
    result = result.filter((i) => i.hasAlerts);
  } else if (filters.hasAlerts === false) {
    result = result.filter((i) => !i.hasAlerts);
  }

  if (filters.hasSchedulerNotes === true) {
    result = result.filter((i) => i.hasSchedulerNotes);
  } else if (filters.hasSchedulerNotes === false) {
    result = result.filter((i) => !i.hasSchedulerNotes);
  }

  if (filters.hasPossibleMerge === true) {
    result = result.filter((i) => i.hasPossibleMerge);
  }

  if (filters.hasMissingInfo === true) {
    result = result.filter((i) => i.hasMissingInfo);
  }

  return result;
}

// ── Sorting ──

const CATEGORY_ORDER: Record<QueueItemCategory, number> = {
  merge_suggested: 0,
  needs_confirmation: 1,
  app_unscheduled: 2,
  unscheduled: 3,
  discrepancy: 4,
  not_in_rforce: 5,
};

export function sortQueueItems(
  items: QueueItem[],
  sortBy: SortOption,
  sortDir: "asc" | "desc"
): QueueItem[] {
  const sorted = [...items];
  const dir = sortDir === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (sortBy) {
      case "default":
        // Primary: category priority. Secondary: customer name
        if (a.category !== b.category) {
          return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
        }
        return (a.customerName || "").localeCompare(b.customerName || "") * dir;

      case "oldest":
      case "scheduled_date":
        return compareOptional(a.effectiveDate, b.effectiveDate, dir, true);

      case "newest":
        return compareOptional(a.effectiveDate, b.effectiveDate, -dir, true);

      case "customer_name":
        return (a.customerName || "").localeCompare(b.customerName || "") * dir;

      case "city":
        return (a.city || "").localeCompare(b.city || "") * dir;

      case "wo_type":
        return (a.normalizedWoType || "").localeCompare(b.normalizedWoType || "") * dir;

      case "product_count":
        return ((a.productCount || 0) - (b.productCount || 0)) * dir;

      case "wo_number":
        return (a.workOrderNumber || "").localeCompare(b.workOrderNumber || "") * dir;

      default:
        return 0;
    }
  });

  return sorted;
}

function compareOptional(a: string | undefined, b: string | undefined, dir: number, nullsLast: boolean): number {
  if (!a && !b) return 0;
  if (!a) return nullsLast ? 1 : -1;
  if (!b) return nullsLast ? -1 : 1;
  return a.localeCompare(b) * dir;
}

// ── Category counts (respects other active filters but not category filter itself) ──

export function getCategoryCounts(
  allItems: QueueItem[],
  filters: QueueFilterState
): Record<string, number> {
  // Apply all filters except category
  const filtersWithoutCategory = { ...filters, categories: [] };
  const baseFiltered = filterQueueItems(allItems, filtersWithoutCategory);

  const counts: Record<string, number> = {};
  for (const item of baseFiltered) {
    counts[item.category] = (counts[item.category] || 0) + 1;
  }
  return counts;
}

// ── Unique resources from dataset ──

export function getUniqueResources(items: QueueItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.assignedResource) set.add(item.assignedResource);
  }
  return Array.from(set).sort();
}

// ── Unique cities from dataset ──

export function getUniqueCities(items: QueueItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.city) set.add(item.city);
  }
  return Array.from(set).sort();
}

// ── Active filter description (for chips) ──

export interface ActiveFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

export function getActiveFilters(
  filters: QueueFilterState,
  setFilters: (fn: (prev: QueueFilterState) => QueueFilterState) => void
): ActiveFilter[] {
  const active: ActiveFilter[] = [];

  if (filters.search) {
    active.push({
      key: "search",
      label: `Search: "${filters.search}"`,
      onRemove: () => setFilters((f) => ({ ...f, search: "" })),
    });
  }

  for (const wt of filters.woTypes) {
    active.push({
      key: `wo-${wt}`,
      label: `Type: ${wt}`,
      onRemove: () => setFilters((f) => ({ ...f, woTypes: f.woTypes.filter((t) => t !== wt) })),
    });
  }

  for (const cat of filters.categories) {
    active.push({
      key: `cat-${cat}`,
      label: `Status: ${cat}`,
      onRemove: () => setFilters((f) => ({ ...f, categories: f.categories.filter((c) => c !== cat) })),
    });
  }

  if (filters.assignedResource) {
    active.push({
      key: "resource",
      label: `Resource: ${filters.assignedResource === "__unassigned__" ? "Unassigned" : filters.assignedResource}`,
      onRemove: () => setFilters((f) => ({ ...f, assignedResource: "" })),
    });
  }

  if (filters.datePreset) {
    active.push({
      key: "date",
      label: `Date: ${filters.datePreset.replace("_", " ")}`,
      onRemove: () => setFilters((f) => ({ ...f, datePreset: "" })),
    });
  }

  if (filters.city) {
    active.push({
      key: "city",
      label: `City: ${filters.city}`,
      onRemove: () => setFilters((f) => ({ ...f, city: "" })),
    });
  }

  if (filters.zip) {
    active.push({
      key: "zip",
      label: `ZIP: ${filters.zip}`,
      onRemove: () => setFilters((f) => ({ ...f, zip: "" })),
    });
  }

  if (filters.productCountMin != null || filters.productCountMax != null) {
    const min = filters.productCountMin ?? 0;
    const max = filters.productCountMax ?? "∞";
    active.push({
      key: "products",
      label: `Products: ${min}–${max}`,
      onRemove: () => setFilters((f) => ({ ...f, productCountMin: undefined, productCountMax: undefined })),
    });
  }

  if (filters.hasAlerts === true) {
    active.push({
      key: "alerts",
      label: "Has alerts",
      onRemove: () => setFilters((f) => ({ ...f, hasAlerts: null })),
    });
  }

  if (filters.hasSchedulerNotes === true) {
    active.push({
      key: "notes",
      label: "Has scheduler notes",
      onRemove: () => setFilters((f) => ({ ...f, hasSchedulerNotes: null })),
    });
  }

  if (filters.hasPossibleMerge === true) {
    active.push({
      key: "merge",
      label: "Has possible merge",
      onRemove: () => setFilters((f) => ({ ...f, hasPossibleMerge: null })),
    });
  }

  if (filters.hasMissingInfo === true) {
    active.push({
      key: "missing",
      label: "Missing required info",
      onRemove: () => setFilters((f) => ({ ...f, hasMissingInfo: null })),
    });
  }

  return active;
}

// ── Persistence ──

const STORAGE_KEY = "rbanwo-queue-filters";

export function loadPersistedFilters(): QueueFilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_FILTERS;
    const parsed = JSON.parse(stored);
    // Merge with defaults so new fields don't crash
    return { ...DEFAULT_FILTERS, ...parsed };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function persistFilters(filters: QueueFilterState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // quota exceeded — silently skip
  }
}
