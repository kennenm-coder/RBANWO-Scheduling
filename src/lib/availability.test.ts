import { describe, it, expect } from "vitest";
import { getCrewAvailability, isTimeBlockAvailable } from "./availability";
import { AvailabilityRule, AvailabilityException } from "./types";
import { parseISO } from "date-fns";

/** Create a local-timezone Date from YYYY-MM-DD */
function localDate(dateStr: string): Date {
  return parseISO(dateStr);
}

function makeRule(overrides: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return {
    id: "rule-1",
    crew_id: "crew-1",
    kind: "pto",
    department: null,
    start_time: null,
    end_time: null,
    weekdays: [],
    repeat_interval: 1,
    effective_start: "2026-01-01",
    effective_end: null,
    reason: null,
    is_active: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("getCrewAvailability", () => {
  it("returns available when no rules", () => {
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [], []);
    expect(result.available).toBe(true);
    expect(result.unavailableBlocks.size).toBe(0);
  });

  it("marks fully unavailable for all-day PTO", () => {
    const rule = makeRule({
      kind: "pto",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
      reason: "Vacation",
    });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [rule], []);
    expect(result.available).toBe(false);
    expect(result.reason).toBe("Vacation");
    expect(result.unavailableBlocks.size).toBeGreaterThan(0);
  });

  it("does not apply rule to different crew", () => {
    const rule = makeRule({
      crew_id: "crew-2",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [rule], []);
    expect(result.available).toBe(true);
  });

  it("does not apply rule outside effective dates", () => {
    const rule = makeRule({
      effective_start: "2026-08-15",
      effective_end: "2026-08-15",
    });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [rule], []);
    expect(result.available).toBe(true);
  });

  it("marks partial unavailability for timed PTO", () => {
    const rule = makeRule({
      kind: "unavailable",
      start_time: "09:00",
      end_time: "12:00",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [rule], []);
    expect(result.available).toBe(true); // Partially available
    expect(result.unavailableBlocks.has("9-10")).toBe(true);
    expect(result.unavailableBlocks.has("10-12")).toBe(true);
    expect(result.unavailableBlocks.has("2-4")).toBe(false);
  });

  it("respects weekday filter", () => {
    const rule = makeRule({
      weekdays: [1], // Monday only
      effective_start: "2026-01-01",
    });
    // Aug 10, 2026 is a Monday
    const mon = getCrewAvailability("crew-1", localDate("2026-08-10"), [rule], []);
    expect(mon.available).toBe(false);
    // Aug 11, 2026 is a Tuesday
    const tue = getCrewAvailability("crew-1", localDate("2026-08-11"), [rule], []);
    expect(tue.available).toBe(true);
  });

  it("skips rule when exception action is skip", () => {
    const rule = makeRule({
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const exception: AvailabilityException = {
      id: "exc-1",
      rule_id: "rule-1",
      exception_date: "2026-08-10",
      action: "skip",
      override_start_time: null,
      override_end_time: null,
      reason: "Working this day instead",
      created_at: "2026-01-01T00:00:00Z",
    };
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [rule], [exception]);
    expect(result.available).toBe(true);
  });

  it("handles block rule (work window)", () => {
    const rule = makeRule({
      kind: "block",
      start_time: "10:00",
      end_time: "14:00",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [rule], []);
    expect(result.available).toBe(true);
    // 10-12 and 12-2 are within the block window (available)
    expect(result.unavailableBlocks.has("10-12")).toBe(false);
    expect(result.unavailableBlocks.has("12-2")).toBe(false);
    // 9-10, 2-4, 4-6 are outside (unavailable)
    expect(result.unavailableBlocks.has("9-10")).toBe(true);
    expect(result.unavailableBlocks.has("2-4")).toBe(true);
    expect(result.unavailableBlocks.has("4-6")).toBe(true);
  });
});

describe("isTimeBlockAvailable", () => {
  it("returns true for available block", () => {
    const avail = {
      available: true,
      workStart: "08:00",
      workEnd: "18:00",
      unavailableBlocks: new Set<import("./types").TimeBlock>(["9-10"]),
    };
    expect(isTimeBlockAvailable(avail, "10-12")).toBe(true);
  });

  it("returns false for unavailable block", () => {
    const avail = {
      available: true,
      workStart: "08:00",
      workEnd: "18:00",
      unavailableBlocks: new Set<import("./types").TimeBlock>(["9-10"]),
    };
    expect(isTimeBlockAvailable(avail, "9-10")).toBe(false);
  });

  it("returns false when fully unavailable", () => {
    const avail = {
      available: false,
      workStart: "08:00",
      workEnd: "18:00",
      unavailableBlocks: new Set<import("./types").TimeBlock>(),
    };
    expect(isTimeBlockAvailable(avail, "9-10")).toBe(false);
  });
});
