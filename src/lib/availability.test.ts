import { describe, it, expect } from "vitest";
import { getCrewAvailability, isTimeBlockAvailable, checkAvailabilityConflict } from "./availability";
import { AvailabilityRule, AvailabilityException, CalendarBlock } from "./types";
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

  it("blocks the whole day for an all-day office day", () => {
    const rule = makeRule({
      kind: "office_day",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [rule], []);
    expect(result.available).toBe(false);
    expect(result.blockingKind).toBe("office_day");
    expect(result.reason).toBe("Office");
    expect(result.unavailableBlocks.size).toBeGreaterThan(0);
  });

  it("blocks only the window for a timed late day", () => {
    const rule = makeRule({
      kind: "late_day",
      start_time: "08:00",
      end_time: "12:00",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [rule], []);
    expect(result.available).toBe(true); // rest of day stays open
    expect(result.blockingKind).toBeUndefined();
    expect(result.unavailableBlocks.has("9-10")).toBe(true);
    expect(result.unavailableBlocks.has("10-12")).toBe(true);
    expect(result.unavailableBlocks.has("2-4")).toBe(false);
  });

  it("lets PTO win over a coinciding all-day office day", () => {
    const office = makeRule({
      id: "rule-office",
      kind: "office_day",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const pto = makeRule({
      id: "rule-pto",
      kind: "pto",
      reason: "Vacation",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [office, pto], []);
    expect(result.available).toBe(false);
    expect(result.blockingKind).toBe("pto");
    expect(result.reason).toBe("Vacation");
  });
});

function makeBlock(overrides: Partial<CalendarBlock> = {}): CalendarBlock {
  return {
    id: "block-1",
    kind: "holiday",
    start_date: "2026-08-10",
    end_date: null,
    start_time: null,
    end_time: null,
    reason: null,
    is_active: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("getCrewAvailability — company-wide blocks", () => {
  it("blocks the whole day for every crew on an all-day holiday", () => {
    const holiday = makeBlock({ reason: "Thanksgiving" });
    // Same block applies regardless of which crew we ask about.
    for (const crewId of ["crew-1", "crew-2", "crew-99"]) {
      const result = getCrewAvailability(crewId, localDate("2026-08-10"), [], [], [holiday]);
      expect(result.available).toBe(false);
      expect(result.blockingKind).toBe("holiday");
      expect(result.reason).toBe("Thanksgiving");
    }
  });

  it("uses the kind label when a holiday has no reason", () => {
    const holiday = makeBlock();
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [], [], [holiday]);
    expect(result.reason).toBe("Holiday");
  });

  it("blocks only the overlapping window for a timed all-office meeting", () => {
    const meeting = makeBlock({
      kind: "company_meeting",
      start_time: "10:00",
      end_time: "11:00",
      reason: "All-hands",
    });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [], [], [meeting]);
    expect(result.available).toBe(true); // rest of day stays open
    expect(result.blockingKind).toBeUndefined();
    expect(result.unavailableBlocks.has("10-12")).toBe(true);
    expect(result.unavailableBlocks.has("2-4")).toBe(false);
  });

  it("applies a multi-day closure across its whole range", () => {
    const closure = makeBlock({
      start_date: "2026-08-10",
      end_date: "2026-08-12",
      reason: "Shutdown",
    });
    expect(getCrewAvailability("crew-1", localDate("2026-08-11"), [], [], [closure]).available).toBe(false);
    // A day outside the range is clear.
    expect(getCrewAvailability("crew-1", localDate("2026-08-13"), [], [], [closure]).available).toBe(true);
  });

  it("lets a company holiday win over a coinciding crew PTO", () => {
    const pto = makeRule({
      kind: "pto",
      reason: "Vacation",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const holiday = makeBlock({ reason: "Christmas" });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [pto], [], [holiday]);
    expect(result.available).toBe(false);
    expect(result.blockingKind).toBe("holiday");
    expect(result.reason).toBe("Christmas");
  });

  it("ignores inactive company blocks", () => {
    const holiday = makeBlock({ is_active: false });
    const result = getCrewAvailability("crew-1", localDate("2026-08-10"), [], [], [holiday]);
    expect(result.available).toBe(true);
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

describe("checkAvailabilityConflict", () => {
  it("returns null when the day is clear", () => {
    const conflict = checkAvailabilityConflict(
      "crew-1", "2026-08-10", 1, "10-12", null, [], []
    );
    expect(conflict).toBeNull();
  });

  it("flags scheduling onto an all-day office day", () => {
    const rule = makeRule({
      kind: "office_day",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const conflict = checkAvailabilityConflict(
      "crew-1", "2026-08-10", 1, "10-12", null, [rule], []
    );
    expect(conflict).not.toBeNull();
    expect(conflict!.fullDay).toBe(true);
    expect(conflict!.reason).toBe("Office");
  });

  it("flags a block inside a timed late-day window but not outside it", () => {
    const rule = makeRule({
      kind: "late_day",
      start_time: "08:00",
      end_time: "12:00",
      effective_start: "2026-08-10",
      effective_end: "2026-08-10",
    });
    const inside = checkAvailabilityConflict(
      "crew-1", "2026-08-10", 1, "10-12", null, [rule], []
    );
    expect(inside).not.toBeNull();
    expect(inside!.fullDay).toBe(false);

    const outside = checkAvailabilityConflict(
      "crew-1", "2026-08-10", 1, "2-4", null, [rule], []
    );
    expect(outside).toBeNull();
  });

  it("flags a full-day block on any day a multi-day job spans", () => {
    const rule = makeRule({
      kind: "pto",
      reason: "Vacation",
      effective_start: "2026-08-12",
      effective_end: "2026-08-12",
    });
    // 3-day job starting 8/10 spans 8/10, 8/11, 8/12 — PTO is on day 3.
    const conflict = checkAvailabilityConflict(
      "crew-1", "2026-08-10", 3, "full_day", null, [rule], []
    );
    expect(conflict).not.toBeNull();
    expect(conflict!.date).toBe("2026-08-12");
    expect(conflict!.fullDay).toBe(true);
  });
});
