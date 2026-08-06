import { describe, it, expect } from "vitest";
import {
  filterQueueItems,
  sortQueueItems,
  getActiveFilters,
  DEFAULT_FILTERS,
  type QueueFilterState,
} from "./queue-filters";
import type { QueueItem, QueueItemCategory } from "./types";

// ── Factory ──

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "qi-1",
    category: "needs_confirmation",
    customerName: "Test Customer",
    address: "123 Main St, Toledo, OH 43615",
    workOrderNumber: "WO-100",
    orderNumber: "ORD-100",
    workOrderType: "Install",
    productCount: 5,
    normalizedWoType: "install",
    sourceWoType: "Install",
    effectiveDate: "2026-08-06",
    assignedResource: "John Smith",
    city: "Toledo",
    state: "OH",
    zip: "43615",
    orderStatus: "Scheduled",
    woStatus: "Open",
    windows: 4,
    patioDoors: 1,
    doors: 0,
    hasAlerts: false,
    hasSchedulerNotes: false,
    hasPossibleMerge: false,
    hasMissingInfo: false,
    ...overrides,
  };
}

describe("filterQueueItems", () => {
  it("returns all items with default filters", () => {
    const items = [makeQueueItem(), makeQueueItem({ id: "qi-2" })];
    const result = filterQueueItems(items, { ...DEFAULT_FILTERS });
    expect(result).toHaveLength(2);
  });

  it("filters by search on customer name", () => {
    const items = [
      makeQueueItem({ id: "qi-1", customerName: "Alice Jones" }),
      makeQueueItem({ id: "qi-2", customerName: "Bob Smith" }),
    ];
    const filters = { ...{ ...DEFAULT_FILTERS }, search: "alice" };
    const result = filterQueueItems(items, filters);
    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("Alice Jones");
  });

  it("filters by search on WO number", () => {
    const items = [
      makeQueueItem({ id: "qi-1", workOrderNumber: "WO-12345" }),
      makeQueueItem({ id: "qi-2", workOrderNumber: "WO-99999" }),
    ];
    const filters = { ...{ ...DEFAULT_FILTERS }, search: "12345" };
    const result = filterQueueItems(items, filters);
    expect(result).toHaveLength(1);
  });

  it("filters by WO type", () => {
    const items = [
      makeQueueItem({ id: "qi-1", normalizedWoType: "install" }),
      makeQueueItem({ id: "qi-2", normalizedWoType: "service" }),
      makeQueueItem({ id: "qi-3", normalizedWoType: "install" }),
    ];
    const filters = { ...{ ...DEFAULT_FILTERS }, woTypes: ["install"] };
    const result = filterQueueItems(items, filters);
    expect(result).toHaveLength(2);
  });

  it("filters by multiple WO types (union)", () => {
    const items = [
      makeQueueItem({ id: "qi-1", normalizedWoType: "install" }),
      makeQueueItem({ id: "qi-2", normalizedWoType: "service" }),
      makeQueueItem({ id: "qi-3", normalizedWoType: "tech_measure" }),
    ];
    const filters = { ...{ ...DEFAULT_FILTERS }, woTypes: ["install", "service"] };
    const result = filterQueueItems(items, filters);
    expect(result).toHaveLength(2);
  });

  it("filters by category", () => {
    const items = [
      makeQueueItem({ id: "qi-1", category: "needs_confirmation" }),
      makeQueueItem({ id: "qi-2", category: "unscheduled" }),
    ];
    const filters = { ...{ ...DEFAULT_FILTERS }, categories: ["unscheduled" as QueueItemCategory] };
    const result = filterQueueItems(items, filters);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("unscheduled");
  });

  it("filters by city", () => {
    const items = [
      makeQueueItem({ id: "qi-1", city: "Toledo" }),
      makeQueueItem({ id: "qi-2", city: "Maumee" }),
    ];
    const filters = { ...{ ...DEFAULT_FILTERS }, city: "Toledo" };
    const result = filterQueueItems(items, filters);
    expect(result).toHaveLength(1);
  });

  it("filters by boolean toggles (hasAlerts)", () => {
    const items = [
      makeQueueItem({ id: "qi-1", hasAlerts: true }),
      makeQueueItem({ id: "qi-2", hasAlerts: false }),
    ];
    const filters = { ...{ ...DEFAULT_FILTERS }, hasAlerts: true };
    const result = filterQueueItems(items, filters);
    expect(result).toHaveLength(1);
    expect(result[0].hasAlerts).toBe(true);
  });
});

describe("sortQueueItems", () => {
  it("sorts by customer name ascending", () => {
    const items = [
      makeQueueItem({ id: "qi-1", customerName: "Zara" }),
      makeQueueItem({ id: "qi-2", customerName: "Alice" }),
    ];
    const sorted = sortQueueItems(items, "customer_name", "asc");
    expect(sorted[0].customerName).toBe("Alice");
    expect(sorted[1].customerName).toBe("Zara");
  });

  it("sorts by date ascending", () => {
    const items = [
      makeQueueItem({ id: "qi-1", effectiveDate: "2026-09-01" }),
      makeQueueItem({ id: "qi-2", effectiveDate: "2026-08-01" }),
    ];
    const sorted = sortQueueItems(items, "oldest", "asc");
    expect(sorted[0].effectiveDate).toBe("2026-08-01");
  });

  it("sorts by product count descending", () => {
    const items = [
      makeQueueItem({ id: "qi-1", productCount: 3 }),
      makeQueueItem({ id: "qi-2", productCount: 10 }),
    ];
    const sorted = sortQueueItems(items, "product_count", "desc");
    expect(sorted[0].productCount).toBe(10);
  });
});

describe("getActiveFilters", () => {
  it("returns empty array for default filters", () => {
    const filters = { ...DEFAULT_FILTERS };
    const active = getActiveFilters(filters, () => {});
    expect(active).toHaveLength(0);
  });

  it("returns chip for search", () => {
    const filters = { ...{ ...DEFAULT_FILTERS }, search: "test" };
    const active = getActiveFilters(filters, () => {});
    expect(active.length).toBeGreaterThan(0);
    expect(active.some((a) => a.label.includes("test"))).toBe(true);
  });

  it("returns chip for each selected WO type", () => {
    const filters = { ...{ ...DEFAULT_FILTERS }, woTypes: ["install", "service"] };
    const active = getActiveFilters(filters, () => {});
    expect(active.filter((a) => a.key.startsWith("wo-"))).toHaveLength(2);
  });
});
