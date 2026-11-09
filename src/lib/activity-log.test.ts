import { describe, it, expect } from "vitest";
import {
  ACTIVITY_ACTIONS,
  type ActivityEntry,
  appointmentDbActions,
  configActionKey,
  configActionPairs,
  dayRangeToIso,
  describeAppointmentChange,
  describeBlock,
  describeDeletedAppointment,
  describeRule,
  distinctActors,
  hasActiveFilters,
  EMPTY_FILTERS,
  mergeFeeds,
  normalizeAppointmentEvent,
  normalizeConfigEvent,
  sanitizeSearch,
  sourcesForActions,
} from "./activity-log";

function entry(key: string, at: string, source: "appointment" | "config" = "appointment"): ActivityEntry {
  return {
    key,
    source,
    action: "updated",
    at,
    actorId: null,
    actorName: null,
    summary: null,
    reason: null,
    appointmentId: null,
    customer: null,
    workOrder: null,
    orderNumber: null,
    scheduledDate: null,
    crewId: null,
    before: null,
    after: null,
  };
}

describe("action catalogue", () => {
  it("maps config rows to unified keys that exist in the catalogue", () => {
    expect(configActionKey("availability_rule", "created")).toBe("availability_rule_created");
    expect(configActionKey("calendar_block", "deleted")).toBe("calendar_block_deleted");
    expect(configActionKey("appointment", "deleted")).toBe("appointment_deleted");
    for (const [entity, act] of [
      ["availability_rule", "created"],
      ["availability_rule", "updated"],
      ["availability_rule", "deleted"],
      ["calendar_block", "created"],
      ["calendar_block", "updated"],
      ["calendar_block", "deleted"],
      ["appointment", "deleted"],
    ]) {
      expect(ACTIVITY_ACTIONS[configActionKey(entity, act)]).toBeDefined();
    }
  });

  it("only queries the table that can hold the selected actions", () => {
    expect(sourcesForActions([])).toEqual({ appointment: true, config: true });
    expect(sourcesForActions(["cancelled"])).toEqual({ appointment: true, config: false });
    expect(sourcesForActions(["availability_rule_created"])).toEqual({ appointment: false, config: true });
    expect(sourcesForActions(["cancelled", "calendar_block_deleted"])).toEqual({ appointment: true, config: true });
  });

  it("splits selected keys into per-table filters", () => {
    expect(appointmentDbActions(["cancelled", "availability_rule_created", "drag_moved"])).toEqual(["cancelled", "drag_moved"]);
    expect(configActionPairs(["cancelled", "availability_rule_created", "appointment_deleted"])).toEqual([
      { entityType: "availability_rule", dbAction: "created" },
      { entityType: "appointment", dbAction: "deleted" },
    ]);
  });
});

describe("normalizing rows", () => {
  const base = {
    id: "e1",
    appointment_id: "a1",
    action: "rescheduled" as const,
    actor_id: "u1",
    actor_name_snapshot: "Pat",
    before_state: { scheduled_date: "2026-11-10", time_block: "9-10" },
    after_state: { scheduled_date: "2026-11-12", time_block: "9-10" },
    reason: "Customer asked",
    created_at: "2026-11-09T15:00:00Z",
  };

  it("flattens the embedded appointment (object or array form)", () => {
    const snap = { customer_name: "Smith", work_order_number: "WO-1", order_number: "O-1", scheduled_date: "2026-11-12", crew_id: "c1" };
    const a = normalizeAppointmentEvent({ ...base, appointment: snap });
    const b = normalizeAppointmentEvent({ ...base, appointment: [snap] });
    expect(a.customer).toBe("Smith");
    expect(a.workOrder).toBe("WO-1");
    expect(b).toEqual(a);
    expect(a.key).toBe("a:e1");
    expect(a.summary).toBe("date 2026-11-10 → 2026-11-12");
  });

  it("survives a missing appointment", () => {
    const e = normalizeAppointmentEvent({ ...base, appointment: null });
    expect(e.customer).toBeNull();
    expect(e.appointmentId).toBe("a1");
  });

  it("keeps the deleted-tile snapshot searchable fields", () => {
    const e = normalizeConfigEvent({
      id: "c1",
      entity_type: "appointment",
      entity_id: "a9",
      action: "deleted",
      actor_id: null,
      actor_name_snapshot: "Admin",
      summary: "Jones · WO 5",
      reason: null,
      before_state: { customer_name: "Jones", work_order_number: "5", scheduled_date: "2026-11-01", crew_id: "c2" },
      after_state: null,
      created_at: "2026-11-09T16:00:00Z",
    });
    expect(e.action).toBe("appointment_deleted");
    expect(e.customer).toBe("Jones");
    expect(e.workOrder).toBe("5");
    expect(e.crewId).toBe("c2");
    expect(e.key).toBe("c:c1");
  });

  it("does not invent a customer for availability rules", () => {
    const e = normalizeConfigEvent({
      id: "c2",
      entity_type: "availability_rule",
      entity_id: "r1",
      action: "created",
      actor_id: null,
      actor_name_snapshot: null,
      summary: "Office Day · 2026-11-10",
      reason: null,
      before_state: null,
      after_state: { crew_id: "c1", kind: "office_day" },
      created_at: "2026-11-09T16:00:00Z",
    });
    expect(e.customer).toBeNull();
    expect(e.crewId).toBe("c1");
  });
});

describe("describeAppointmentChange", () => {
  it("lists only the fields that changed", () => {
    expect(
      describeAppointmentChange("rescheduled", { scheduled_date: "a", time_block: "x", status: "scheduled" }, { scheduled_date: "b", time_block: "x", status: "scheduled" })
    ).toBe("date a → b");
  });
  it("shows landing values for creation-style events", () => {
    expect(describeAppointmentChange("created", null, { scheduled_date: "2026-11-10", status: "scheduled" })).toBe(
      "date 2026-11-10, status scheduled"
    );
  });
  it("returns null with nothing recognisable", () => {
    expect(describeAppointmentChange("flagged", null, null)).toBeNull();
    expect(describeAppointmentChange("flagged", { foo: 1 }, { foo: 2 })).toBeNull();
  });
  it("renders null values as a dash", () => {
    expect(describeAppointmentChange("unscheduled", { scheduled_date: "2026-11-10" }, { scheduled_date: null })).toBe(
      "date 2026-11-10 → —"
    );
  });
});

describe("describeRule / describeBlock / describeDeletedAppointment", () => {
  it("describes a one-day Office Day tile without weekdays", () => {
    expect(describeRule({ kind: "office_day", effective_start: "2026-11-10", effective_end: "2026-11-10", weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe(
      "Office Day · 2026-11-10"
    );
  });
  it("describes a recurring rule", () => {
    expect(
      describeRule({ kind: "late_day", weekdays: [3, 1], effective_start: "2026-11-02", effective_end: null, start_time: "10:00:00", end_time: "17:00:00" })
    ).toBe("Late Day · Mon, Wed · from 2026-11-02 · 10:00–17:00");
  });
  it("mentions interval, department and reason", () => {
    const s = describeRule({ kind: "role_assignment", department: "Install", weekdays: [5], repeat_interval: 2, effective_start: "2026-11-06", reason: "Training" });
    expect(s).toContain("Role assignment (Install)");
    expect(s).toContain("every 2 wks Fri");
    expect(s).toContain("“Training”");
  });
  it("falls back for unknown kinds", () => {
    expect(describeRule({})).toBe("Rule");
    expect(describeRule({ kind: "weird" })).toBe("weird");
  });
  it("describes blocks", () => {
    expect(describeBlock({ kind: "holiday", start_date: "2026-12-24", end_date: "2026-12-26", reason: "Christmas" })).toBe(
      "Holiday · 2026-12-24 → 2026-12-26 · “Christmas”"
    );
    expect(describeBlock({ kind: "company_meeting", start_date: "2026-11-12", start_time: "09:00:00", end_time: "10:30:00" })).toBe(
      "Office meeting · 2026-11-12 · 09:00–10:30"
    );
  });
  it("describes a deleted tile", () => {
    expect(describeDeletedAppointment({ customer_name: "Jones", work_order_number: "5", appointment_type: "install", scheduled_date: "2026-11-01", status: "scheduled" })).toBe(
      "Jones · WO 5 · install · 2026-11-01 · (was scheduled)"
    );
    expect(describeDeletedAppointment({})).toBe("Tile deleted");
  });
});

describe("mergeFeeds", () => {
  const a = [entry("a:3", "2026-11-09T12:00:00Z"), entry("a:2", "2026-11-09T10:00:00Z"), entry("a:1", "2026-11-09T08:00:00Z")];
  const c = [entry("c:2", "2026-11-09T11:00:00Z", "config"), entry("c:1", "2026-11-09T09:00:00Z", "config")];

  it("interleaves newest first and trims to the page size", () => {
    const m = mergeFeeds([a, c], 4);
    expect(m.entries.map((e) => e.key)).toEqual(["a:3", "c:2", "a:2", "c:1"]);
    expect(m.cursor).toBe("2026-11-09T09:00:00Z");
    expect(m.hasMore).toBe(true); // a:1 was cut
  });

  it("reports no more when every source came back short", () => {
    const m = mergeFeeds([a, c], 10);
    expect(m.entries).toHaveLength(5);
    expect(m.hasMore).toBe(false);
  });

  it("reports more when a source filled its page even if nothing was cut", () => {
    const m = mergeFeeds([a, []], 3);
    expect(m.entries).toHaveLength(3);
    expect(m.hasMore).toBe(true);
  });

  it("skips already-shown keys (inclusive cursor re-fetch) and duplicates", () => {
    const m = mergeFeeds([a, a], 10, new Set(["a:3"]));
    expect(m.entries.map((e) => e.key)).toEqual(["a:2", "a:1"]);
  });

  it("orders identical timestamps deterministically", () => {
    const t = "2026-11-09T12:00:00Z";
    const m = mergeFeeds([[entry("a:1", t)], [entry("c:1", t, "config")]], 10);
    expect(m.entries.map((e) => e.key)).toEqual(["c:1", "a:1"]);
  });

  it("handles empty feeds", () => {
    expect(mergeFeeds([[], []], 5)).toEqual({ entries: [], cursor: null, hasMore: false });
  });
});

describe("filters", () => {
  it("detects active filters", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: "  " })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, actor: "Pat" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, actions: ["cancelled"] })).toBe(true);
  });

  it("turns an inclusive local-day range into [gte, lt) instants", () => {
    const { gte, lt } = dayRangeToIso("2026-11-09", "2026-11-09");
    expect(gte).toBe(new Date(2026, 10, 9).toISOString());
    expect(lt).toBe(new Date(2026, 10, 10).toISOString());
  });

  it("rolls the upper bound across a month end", () => {
    expect(dayRangeToIso(null, "2026-11-30").lt).toBe(new Date(2026, 11, 1).toISOString());
  });

  it("ignores empty or malformed dates", () => {
    expect(dayRangeToIso(null, null)).toEqual({ gte: null, lt: null });
    expect(dayRangeToIso("garbage", "2026-1-1")).toEqual({ gte: null, lt: null });
  });

  it("strips characters that would break a PostgREST filter", () => {
    expect(sanitizeSearch("O'Brien, (Jr)  100%_x")).toBe("O Brien Jr 100 x");
    expect(sanitizeSearch("  smith ")).toBe("smith");
  });

  it("lists actors by frequency, then name", () => {
    expect(
      distinctActors([
        { actor_name_snapshot: "Zed" },
        { actor_name_snapshot: "Amy" },
        { actor_name_snapshot: "Zed" },
        { actor_name_snapshot: null },
        { actor_name_snapshot: "  " },
        { actor_name_snapshot: "Bob" },
      ])
    ).toEqual(["Zed", "Amy", "Bob"]);
  });
});
