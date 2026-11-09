import { describe, it, expect } from "vitest";
import { parseISO } from "date-fns";
import { checkAvailabilityConflict, getCrewAvailability, isOneDaySpecialRule } from "./availability";
import { blockedVisualFor } from "./blocked-visuals";
import type { AvailabilityRule } from "./types";

function oneDay(overrides: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return {
    id: "rule-1",
    crew_id: "crew-1",
    kind: "special_ops",
    department: null,
    start_time: null,
    end_time: null,
    weekdays: [],
    repeat_interval: 1,
    effective_start: "2026-12-14",
    effective_end: "2026-12-14",
    reason: null,
    is_active: true,
    created_by: null,
    created_at: "2026-12-01T00:00:00Z",
    updated_at: "2026-12-01T00:00:00Z",
    ...overrides,
  };
}

describe("special assignments (Special Ops / Office Day drag)", () => {
  it("blocks the crew's whole day, only on the dropped date", () => {
    const rules = [oneDay()];
    const hit = getCrewAvailability("crew-1", parseISO("2026-12-14"), rules, []);
    expect(hit.available).toBe(false);
    expect(hit.blockingKind).toBe("special_ops");
    expect(hit.blockingRuleId).toBe("rule-1");
    expect(hit.reason).toBe("Special Ops");

    expect(getCrewAvailability("crew-1", parseISO("2026-12-15"), rules, []).available).toBe(true);
    expect(getCrewAvailability("crew-2", parseISO("2026-12-14"), rules, []).available).toBe(true);
  });

  it("labels an Office Day drop as Office", () => {
    const a = getCrewAvailability("crew-1", parseISO("2026-12-14"), [oneDay({ kind: "office_day" })], []);
    expect(a.blockingKind).toBe("office_day");
    expect(a.reason).toBe("Office");
  });

  it("can still be booked over: the day reports a full-day conflict to override", () => {
    const conflict = checkAvailabilityConflict("crew-1", "2026-12-14", 1, "full_day", null, [oneDay()], []);
    expect(conflict).toEqual({ reason: "Special Ops", date: "2026-12-14", fullDay: true });
  });

  it("loses to PTO but beats a plain Office Day on the same date", () => {
    const pto = oneDay({ id: "pto", kind: "pto" });
    const office = oneDay({ id: "office", kind: "office_day" });
    const special = oneDay({ id: "special" });
    expect(getCrewAvailability("crew-1", parseISO("2026-12-14"), [office, special], []).blockingRuleId).toBe("special");
    expect(getCrewAvailability("crew-1", parseISO("2026-12-14"), [special, pto], []).blockingKind).toBe("pto");
  });

  it("only treats a dragged one-day rule as removable, never a weekly one", () => {
    expect(isOneDaySpecialRule(oneDay())).toBe(true);
    expect(isOneDaySpecialRule(oneDay({ kind: "office_day" }))).toBe(true);
    expect(isOneDaySpecialRule(oneDay({ weekdays: [3] }))).toBe(false);
    expect(isOneDaySpecialRule(oneDay({ effective_end: null }))).toBe(false);
    expect(isOneDaySpecialRule(oneDay({ start_time: "09:00", end_time: "11:00" }))).toBe(false);
    expect(isOneDaySpecialRule(oneDay({ kind: "pto" }))).toBe(false);
    expect(isOneDaySpecialRule(undefined)).toBe(false);
  });

  it("has its own visual so it reads differently from Office", () => {
    expect(blockedVisualFor("special_ops").accent).toBe("var(--blk-special)");
    expect(blockedVisualFor("special_ops").accent).not.toBe(blockedVisualFor("office_day").accent);
  });
});
