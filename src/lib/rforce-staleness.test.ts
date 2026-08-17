import { describe, it, expect } from "vitest";
import { latestImportTime, isOrderStale, STALE_THRESHOLD_MS } from "./rforce-staleness";

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
