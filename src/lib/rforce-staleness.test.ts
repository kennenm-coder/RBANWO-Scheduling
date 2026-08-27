import { describe, it, expect } from "vitest";
import {
  latestImportTime,
  isOrderStale,
  STALE_THRESHOLD_MS,
  missedExportCount,
  dropTier,
  detectLatestExportDate,
} from "./rforce-staleness";

describe("rforce-staleness", () => {
  const day = 24 * 60 * 60 * 1000;

  it("finds the newest import timestamp", () => {
    const latest = latestImportTime([
      { updated_at: "2026-08-06T18:00:00Z" },
      { updated_at: "2026-08-17T17:00:00Z" },
      { updated_at: null },
    ]);
    expect(latest).toBe(Date.parse("2026-08-17T17:00:00Z"));
  });

  it("flags an order that fell well behind the newest import", () => {
    const latest = Date.parse("2026-08-17T17:00:00Z");
    // 11 days behind → stale (the Michael Suffel case)
    expect(isOrderStale({ updated_at: "2026-08-06T18:00:00Z" }, latest)).toBe(true);
  });

  it("does not flag an order seen in a recent import", () => {
    const latest = Date.parse("2026-08-17T17:00:00Z");
    // same import / within threshold → not stale
    expect(isOrderStale({ updated_at: "2026-08-17T17:00:00Z" }, latest)).toBe(false);
    expect(isOrderStale({ updated_at: "2026-08-16T17:00:00Z" }, latest)).toBe(false);
  });

  it("uses the 2-day threshold boundary", () => {
    const latest = Date.parse("2026-08-17T00:00:00Z");
    const justInside = new Date(latest - (STALE_THRESHOLD_MS - day / 2)).toISOString();
    const wayBehind = new Date(latest - (STALE_THRESHOLD_MS + day)).toISOString();
    expect(isOrderStale({ updated_at: justInside }, latest)).toBe(false);
    expect(isOrderStale({ updated_at: wayBehind }, latest)).toBe(true);
  });

  it("returns false with no data", () => {
    expect(isOrderStale({ updated_at: null }, 123)).toBe(false);
    expect(isOrderStale({ updated_at: "2026-08-06T18:00:00Z" }, 0)).toBe(false);
  });
});

describe("export-count drop detection (two-tier)", () => {
  // Daily exports ran Mon–Thu; an order last seen Monday missed Tue/Wed/Thu.
  const exportDates = ["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24"]; // Thu..Mon

  describe("missedExportCount", () => {
    it("counts exports that ran after the order was last seen", () => {
      // last seen Monday 08-24 → missed Tue/Wed/Thu = 3
      expect(missedExportCount({ updated_at: "2026-08-24T12:05:00Z" }, exportDates)).toBe(3);
      // last seen Wednesday → missed only Thursday = 1
      expect(missedExportCount({ updated_at: "2026-08-26T12:05:00Z" }, exportDates)).toBe(1);
      // last seen in today's export → 0 misses
      expect(missedExportCount({ updated_at: "2026-08-27T12:05:00Z" }, exportDates)).toBe(0);
    });

    it("ignores the time of day — an incremental sync after the export is still 'seen today'", () => {
      // touched by a 4pm incremental today → date is today → 0 misses
      expect(missedExportCount({ updated_at: "2026-08-27T16:00:00Z" }, exportDates)).toBe(0);
    });

    it("does not count a skipped export day (gap-safe)", () => {
      // Wednesday's export never ran, so it isn't in the list. Order last seen
      // Monday missed only Tue + Thu = 2, not 3.
      const withGap = ["2026-08-27", "2026-08-25", "2026-08-24"]; // no 08-26
      expect(missedExportCount({ updated_at: "2026-08-24T12:05:00Z" }, withGap)).toBe(2);
    });

    it("returns 0 with no timestamp or no export history", () => {
      expect(missedExportCount({ updated_at: null }, exportDates)).toBe(0);
      expect(missedExportCount({ updated_at: "2026-08-24T12:05:00Z" }, [])).toBe(0);
    });
  });

  describe("dropTier", () => {
    it("is present when seen in the latest export", () => {
      expect(dropTier({ updated_at: "2026-08-27T12:05:00Z" }, exportDates)).toBe("present");
    });
    it("is possible_cancel after missing one export (amber)", () => {
      expect(dropTier({ updated_at: "2026-08-26T12:05:00Z" }, exportDates)).toBe("possible_cancel");
    });
    it("is likely_cancel after missing two or more exports (red)", () => {
      expect(dropTier({ updated_at: "2026-08-25T12:05:00Z" }, exportDates)).toBe("likely_cancel");
      expect(dropTier({ updated_at: "2026-08-24T12:05:00Z" }, exportDates)).toBe("likely_cancel");
    });
  });

  describe("detectLatestExportDate", () => {
    const big = (date: string, n: number) =>
      Array.from({ length: n }, () => ({ updated_at: `${date}T12:05:00Z` }));

    it("picks the newest date whose cluster is a full export", () => {
      const orders = [
        ...big("2026-08-27", 150), // today's full export
        ...big("2026-08-26", 8), // hourly incremental — too small
        { updated_at: "2026-08-20T12:05:00Z" }, // a dropped order
      ];
      expect(detectLatestExportDate(orders)).toEqual({ date: "2026-08-27", orderCount: 150 });
    });

    it("ignores incremental-only days below the full-export threshold", () => {
      const orders = big("2026-08-27", 12); // only a small hourly sync so far today
      expect(detectLatestExportDate(orders)).toBeNull();
    });

    it("returns null with no data", () => {
      expect(detectLatestExportDate([])).toBeNull();
    });
  });
});
