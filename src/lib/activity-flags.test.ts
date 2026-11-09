import { describe, it, expect } from "vitest";
import type { ActivityEntry } from "./activity-log";
import {
  flagActivity,
  flagsForTile,
  summarizeFlags,
  worstSeverity,
  type FlagContext,
} from "./activity-flags";
import type {
  Appointment,
  AvailabilityRule,
  CalendarBlock,
} from "./types";
import type { AwaitingRForceIssue, DroppedTileIssue, SchedulingIssue } from "./issues";

const TODAY = "2026-11-01";

function appt(id: string, over: Partial<Appointment> = {}): Appointment {
  return {
    id,
    crew_id: "c1",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "service",
    order_number: null,
    work_order_number: `WO-${id}`,
    customer_name: `Cust ${id}`,
    address: "1 Main",
    scheduled_date: "2026-11-10",
    start_time: null,
    end_time: null,
    duration_days: 1,
    time_block: "9-10",
    status: "scheduled",
    notes: null,
    reschedule_reason: null,
    ...over,
  } as unknown as Appointment;
}

function oneDayRule(id: string, crew: string, date: string, kind: "special_ops" | "office_day" = "special_ops"): AvailabilityRule {
  return {
    id,
    crew_id: crew,
    kind,
    department: null,
    start_time: null,
    end_time: null,
    weekdays: [],
    repeat_interval: 1,
    effective_start: date,
    effective_end: date,
    reason: null,
    is_active: true,
    created_by: null,
    created_at: "",
    updated_at: "",
  } as AvailabilityRule;
}

function ctx(over: Partial<FlagContext> = {}): FlagContext {
  return {
    appointments: [],
    issues: [],
    dropped: [],
    awaiting: [],
    rules: [],
    exceptions: [],
    blocks: [],
    today: TODAY,
    ...over,
  };
}

function entry(key: string, over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    key,
    source: "appointment",
    action: "updated",
    at: "2026-11-01T12:00:00Z",
    actorId: null,
    actorName: null,
    summary: null,
    reason: null,
    appointmentId: null,
    entityId: null,
    customer: null,
    workOrder: null,
    orderNumber: null,
    scheduledDate: null,
    crewId: null,
    before: null,
    after: null,
    ...over,
  };
}

describe("flagsForTile", () => {
  it("is quiet for a healthy tile", () => {
    const a = appt("1");
    expect(flagsForTile(a, ctx({ appointments: [a] }))).toEqual([]);
  });

  it("flags a double-booking red, naming the other job", () => {
    const a = appt("1");
    const b = appt("2");
    const flags = flagsForTile(a, ctx({ appointments: [a, b] }));
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe("red");
    expect(flags[0].code).toBe("double_booked");
    expect(flags[0].message).toContain("Cust 2");
  });

  it("respects an approved overlap on either side", () => {
    const a = appt("1", { allow_overlap: true });
    const b = appt("2");
    expect(flagsForTile(a, ctx({ appointments: [a, b] }))).toEqual([]);
    expect(flagsForTile(b, ctx({ appointments: [a, b] }))).toEqual([]);
  });

  it("flags a booking over PTO / a blocked day amber, unless knowingly overridden", () => {
    const a = appt("1");
    const rules = [oneDayRule("r1", "c1", "2026-11-10")];
    const flags = flagsForTile(a, ctx({ appointments: [a], rules }));
    expect(flags.map((f) => f.code)).toEqual(["over_time_off"]);
    expect(flags[0].severity).toBe("amber");
    const ok = appt("1", { allow_availability_conflict: true });
    expect(flagsForTile(ok, ctx({ appointments: [ok], rules }))).toEqual([]);
  });

  it("ignores history and non-live tiles for app-side checks", () => {
    const past = appt("1", { scheduled_date: "2026-10-20" });
    const past2 = appt("2", { scheduled_date: "2026-10-20" });
    expect(flagsForTile(past, ctx({ appointments: [past, past2] }))).toEqual([]);
    const cancelled = appt("3", { status: "cancelled" });
    const other = appt("4");
    expect(flagsForTile(cancelled, ctx({ appointments: [cancelled, other] }))).toEqual([]);
  });

  it("surfaces the Issues engine's findings with their reason", () => {
    const a = appt("1");
    const mismatch = {
      type: "mismatch",
      appointment: a,
      woNumber: "WO-1",
      mismatchDetails: { date: { app: "2026-11-10", rforce: "2026-11-12" }, crew: { app: "A", rforce: "B" } },
    } as unknown as SchedulingIssue;
    const dropped = { appointment: a, missedExports: 2 } as unknown as DroppedTileIssue;
    const overdue = { appointment: a, tier: "overdue", reason: "not_in_rforce", missedExports: 3 } as unknown as AwaitingRForceIssue;
    const pending = { appointment: a, tier: "pending", reason: "not_in_rforce", missedExports: 0 } as unknown as AwaitingRForceIssue;

    const flags = flagsForTile(a, ctx({ appointments: [a], issues: [mismatch], dropped: [dropped], awaiting: [overdue, pending] }));
    expect(flags.map((f) => f.code)).toEqual(["rforce_mismatch", "rforce_dropped", "rforce_overdue"]);
    expect(flags[0].message).toContain("date (app 2026-11-10, rForce 2026-11-12)");
    expect(flags[0].message).toContain("crew (app A, rForce B)");
    expect(flags[1].severity).toBe("red");
    expect(flags[1].message).toContain("2 daily exports");
    expect(flags[2].severity).toBe("amber");
    expect(worstSeverity(flags)).toBe("red");
  });

  it("does not flag a merely pending rForce tile", () => {
    const a = appt("1");
    const pending = { appointment: a, tier: "pending", reason: "not_in_rforce", missedExports: 0 } as unknown as AwaitingRForceIssue;
    expect(flagsForTile(a, ctx({ appointments: [a], awaiting: [pending] }))).toEqual([]);
  });
});

describe("flagActivity", () => {
  it("flags only the newest entry about a tile", () => {
    const a = appt("1");
    const b = appt("2");
    const entries = [
      entry("a:new", { appointmentId: "1" }),
      entry("a:old", { appointmentId: "1" }),
      entry("a:b", { appointmentId: "2" }),
    ];
    const flags = flagActivity(entries, ctx({ appointments: [a, b] }));
    expect([...flags.keys()].sort()).toEqual(["a:b", "a:new"]);
  });

  it("flags a tile cancelled here but still live in rForce", () => {
    const issue = {
      type: "cancelled_locally",
      woNumber: "WO-9",
      cancelledTile: { id: "9" },
    } as unknown as SchedulingIssue;
    const flags = flagActivity([entry("a:1", { action: "cancelled", appointmentId: "9" })], ctx({ issues: [issue] }));
    const f = flags.get("a:1");
    expect(f?.[0].code).toBe("cancelled_live_in_rforce");
    expect(f?.[0].severity).toBe("red");
  });

  it("leaves a cancelled tile alone when rForce agrees", () => {
    expect(flagActivity([entry("a:1", { action: "cancelled", appointmentId: "9" })], ctx()).size).toBe(0);
  });

  it("flags a deleted tile whose job rForce still has scheduled", () => {
    const missing = { type: "missing", woNumber: " wo-5 " } as unknown as SchedulingIssue;
    const del = entry("c:1", { source: "config", action: "appointment_deleted", entityId: "x", workOrder: "WO-5" });
    const f = flagActivity([del], ctx({ issues: [missing] })).get("c:1");
    expect(f?.[0].code).toBe("deleted_live_in_rforce");
    expect(flagActivity([del], ctx()).size).toBe(0);
  });

  it("flags a new availability rule that lands on booked tiles, counting only that rule's hits", () => {
    const hit = appt("1"); // 2026-11-10
    const miss = appt("2", { scheduled_date: "2026-11-11" });
    const otherCrew = appt("3", { crew_id: "c2" });
    const rule = oneDayRule("r1", "c1", "2026-11-10");
    const e = entry("c:r", { source: "config", action: "availability_rule_created", entityId: "r1" });
    const f = flagActivity([e], ctx({ appointments: [hit, miss, otherCrew], rules: [rule] })).get("c:r");
    expect(f).toHaveLength(1);
    expect(f?.[0].code).toBe("rule_hits_tiles");
    expect(f?.[0].message).toContain("1 booked tile ");
    expect(f?.[0].message).toContain("2026-11-10");
  });

  it("stays quiet when the rule has since been removed or hits nothing", () => {
    const e = entry("c:r", { source: "config", action: "availability_rule_created", entityId: "r1" });
    expect(flagActivity([e], ctx({ appointments: [appt("1")], rules: [] })).size).toBe(0);
    const rule = oneDayRule("r1", "c1", "2026-12-24");
    expect(flagActivity([e], ctx({ appointments: [appt("1")], rules: [rule] })).size).toBe(0);
  });

  it("never flags a delete of a rule", () => {
    const e = entry("c:r", { source: "config", action: "availability_rule_deleted", entityId: "r1" });
    expect(flagActivity([e], ctx({ appointments: [appt("1")], rules: [oneDayRule("r1", "c1", "2026-11-10")] })).size).toBe(0);
  });

  it("flags a company block that covers booked tiles on any crew", () => {
    const block: CalendarBlock = {
      id: "b1",
      kind: "holiday",
      start_date: "2026-11-10",
      end_date: "2026-11-11",
      start_time: null,
      end_time: null,
      reason: "Closed",
      is_active: true,
      created_by: null,
      created_at: "",
      updated_at: "",
    };
    const e = entry("c:b", { source: "config", action: "calendar_block_created", entityId: "b1" });
    const tiles = [appt("1"), appt("2", { crew_id: "c2" }), appt("3", { scheduled_date: "2026-11-20" })];
    const f = flagActivity([e], ctx({ appointments: tiles, blocks: [block] })).get("c:b");
    expect(f?.[0].code).toBe("block_hits_tiles");
    expect(f?.[0].message).toContain("2 booked tiles");
  });
});

describe("summarizeFlags", () => {
  it("counts entries by worst severity and groups reasons, red first", () => {
    const map = new Map([
      ["1", [{ severity: "red", code: "double_booked", message: "" }, { severity: "amber", code: "over_time_off", message: "" }]],
      ["2", [{ severity: "amber", code: "over_time_off", message: "" }]],
      ["3", [{ severity: "amber", code: "rforce_mismatch", message: "" }]],
    ] as const) as unknown as Parameters<typeof summarizeFlags>[0];
    const s = summarizeFlags(map);
    expect(s.red).toBe(1);
    expect(s.amber).toBe(2);
    expect(s.flaggedEntries).toBe(3);
    expect(s.byCode[0]).toMatchObject({ code: "double_booked", severity: "red", count: 1 });
    expect(s.byCode.find((c) => c.code === "over_time_off")?.count).toBe(2);
  });

  it("is empty for no flags", () => {
    expect(summarizeFlags(new Map())).toEqual({ red: 0, amber: 0, flaggedEntries: 0, byCode: [] });
    expect(worstSeverity([])).toBeNull();
  });
});
