import { describe, it, expect } from "vitest";
import { deriveIssues, deriveDroppedTiles } from "./issues";
import type { Appointment, RForceOrder, AppointmentLink } from "./types";

function makeRForceOrder(overrides: Partial<RForceOrder> = {}): RForceOrder {
  return {
    id: "rf-1",
    work_order_number: "WO-100",
    customer_name: "Test Customer",
    address: "123 Main St",
    order_number: null,
    product_count: null,
    scheduled_start: "2026-08-14T10:00:00",
    primary_resource: "Crew A",
    tech_measure_name: null,
    installer: null,
    service_rep: null,
    work_order_type: "Tech Measure",
    import_batch_id: null,
    display_mode: "overlay",
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    ...overrides,
  } as RForceOrder;
}

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    crew_id: "crew-1",
    work_order_number: "WO-100",
    scheduled_date: "2026-08-14",
    start_time: "10:00",
    end_time: "16:00",
    time_block: "full_day",
    status: "scheduled",
    customer_name: "Test Customer",
    address: "123 Main St",
    appointment_type: "tech_measure",
    duration_days: 1,
    version: 1,
    ...overrides,
  } as Appointment;
}

const crew = { id: "crew-1", name: "Crew A", aliases: null } as any;

describe("deriveIssues", () => {
  it("detects missing: rForce scheduled, no local appointment", () => {
    const issues = deriveIssues(
      [makeRForceOrder()],
      [],  // no appointments
      [],  // no links
      [crew],
      []
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("missing");
    expect(issues[0].woNumber).toBe("WO-100");
    expect(issues[0].rforceDate).toBe("2026-08-14");
    expect(issues[0].rforceTime).toBe("10:00");
  });

  it("detects mismatch: linked appointment has different date", () => {
    const rf = makeRForceOrder({ scheduled_start: "2026-08-14T10:00:00" });
    const appt = makeAppointment({ scheduled_date: "2026-08-15" });
    const link: AppointmentLink = {
      id: "link-1",
      appointment_id: "appt-1",
      work_order_number: "WO-100",
      source_system: "rforce",
      external_key: "rf-1",
    } as AppointmentLink;

    const issues = deriveIssues([rf], [appt], [link], [crew], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("mismatch");
    expect(issues[0].mismatchDetails?.date).toEqual({
      app: "2026-08-15",
      rforce: "2026-08-14",
    });
  });

  it("skips time mismatch for full_day appointments", () => {
    const rf = makeRForceOrder({ scheduled_start: "2026-08-14T09:00:00" });
    const appt = makeAppointment({
      scheduled_date: "2026-08-14",
      start_time: "08:00",
      time_block: "full_day",
    });

    const issues = deriveIssues([rf], [appt], [], [crew], []);
    // Same date, full_day → time diff ignored → should be synced, no issues
    expect(issues).toHaveLength(0);
  });

  it("excludes synced orders", () => {
    const rf = makeRForceOrder({ scheduled_start: "2026-08-14T10:00:00" });
    const appt = makeAppointment({
      scheduled_date: "2026-08-14",
      start_time: "10:00",
      time_block: "10-12",
    });

    const issues = deriveIssues([rf], [appt], [], [crew], []);
    expect(issues).toHaveLength(0);
  });

  it("excludes unscheduled rForce orders (no scheduled_start)", () => {
    const rf = makeRForceOrder({ scheduled_start: null });
    const issues = deriveIssues([rf], [], [], [crew], []);
    expect(issues).toHaveLength(0);
  });

  it("treats cancelled appointment as missing", () => {
    const rf = makeRForceOrder();
    const appt = makeAppointment({ status: "cancelled" });
    const issues = deriveIssues([rf], [appt], [], [crew], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("missing");
  });

  it("excludes completed orders from missing (closed jobs need no tile)", () => {
    const rf = makeRForceOrder({ wo_status: "Appt Complete / Closed" });
    const issues = deriveIssues([rf], [], [], [crew], []);
    expect(issues).toHaveLength(0);
  });

  it("excludes cancelled orders from missing", () => {
    const rf = makeRForceOrder({ order_status: "Cancelled" });
    const issues = deriveIssues([rf], [], [], [crew], []);
    expect(issues).toHaveLength(0);
  });

  it("excludes orders already scheduled on the calendar outside the loaded window", () => {
    // rForce says scheduled, no in-window tile — but the WO already has a placed
    // tile elsewhere (passed via the global scheduled-WO set). Not missing.
    const rf = makeRForceOrder({ work_order_number: "WO-777" });
    const scheduled = new Set(["wo-777"]);
    const issues = deriveIssues([rf], [], [], [crew], [], scheduled);
    expect(issues).toHaveLength(0);
  });

  it("still flags missing when the WO is not in the scheduled set", () => {
    const rf = makeRForceOrder({ work_order_number: "WO-888" });
    const issues = deriveIssues([rf], [], [], [crew], [], new Set(["wo-other"]));
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("missing");
  });

  it("skips an order that has been dismissed (WO + date match)", () => {
    const rf = makeRForceOrder(); // WO-100, 2026-08-14
    const dismissals = [
      {
        id: "d-1",
        work_order_number: "WO-100",
        rforce_date: "2026-08-14",
        rforce_start_time: null,
        dismissed_by: null,
        dismissed_at: "2026-08-15T00:00:00Z",
        reason: "cancelled",
      },
    ];
    const issues = deriveIssues([rf], [], [], [crew], [], new Set(), dismissals);
    expect(issues).toHaveLength(0);
  });

  it("does not skip when the dismissal is for a different date", () => {
    const rf = makeRForceOrder(); // WO-100, 2026-08-14
    const dismissals = [
      {
        id: "d-2",
        work_order_number: "WO-100",
        rforce_date: "2026-08-20",
        rforce_start_time: null,
        dismissed_by: null,
        dismissed_at: "2026-08-15T00:00:00Z",
        reason: "cancelled",
      },
    ];
    const issues = deriveIssues([rf], [], [], [crew], [], new Set(), dismissals);
    expect(issues).toHaveLength(1);
  });

  it("attaches approval placement to missing when resource maps to a crew", () => {
    const issues = deriveIssues([makeRForceOrder()], [], [], [crew], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].placement).toEqual({
      crewId: "crew-1",
      timeBlock: "full_day",
      scheduledDate: "2026-08-14",
    });
  });

  it("leaves placement undefined when resource maps to no crew", () => {
    const rf = makeRForceOrder({ primary_resource: "Nobody Unknown" });
    const issues = deriveIssues([rf], [], [], [crew], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("missing");
    expect(issues[0].placement).toBeUndefined();
  });

  it("sorts missing before mismatch", () => {
    const rf1 = makeRForceOrder({ id: "rf-1", work_order_number: "WO-MISMATCH" });
    const rf2 = makeRForceOrder({ id: "rf-2", work_order_number: "WO-MISSING" });
    const appt = makeAppointment({
      work_order_number: "WO-MISMATCH",
      scheduled_date: "2026-08-15", // different date → mismatch
    });

    const issues = deriveIssues([rf1, rf2], [appt], [], [crew], []);
    expect(issues).toHaveLength(2);
    expect(issues[0].type).toBe("missing");
    expect(issues[1].type).toBe("mismatch");
  });
});

describe("deriveDroppedTiles", () => {
  // A recent order keeps `newest` current so the stale one falls behind it.
  const recentOrder = makeRForceOrder({
    id: "rf-recent",
    work_order_number: "WO-RECENT",
    updated_at: "2026-08-17T00:00:00Z",
  });

  // makeAppointment defaults to scheduled_date 2026-08-14; treat "today" as before it.
  const TODAY = "2026-08-10";

  it("flags an active upcoming tile whose order dropped out of recent imports", () => {
    const staleOrder = makeRForceOrder({
      work_order_number: "WO-100",
      updated_at: "2026-08-06T00:00:00Z", // 11 days behind newest → stale
    });
    const appt = makeAppointment({ work_order_number: "WO-100", status: "scheduled" });
    const dropped = deriveDroppedTiles([appt], [staleOrder, recentOrder], [], TODAY);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].woNumber).toBe("WO-100");
    expect(dropped[0].lastSeen).toBe("2026-08-06T00:00:00Z");
  });

  it("does not flag a tile whose order still appears in the latest import", () => {
    const freshOrder = makeRForceOrder({
      work_order_number: "WO-100",
      updated_at: "2026-08-17T00:00:00Z", // same as newest → not stale
    });
    const appt = makeAppointment({ work_order_number: "WO-100" });
    expect(deriveDroppedTiles([appt], [freshOrder, recentOrder], [], TODAY)).toHaveLength(0);
  });

  it("does not flag a past-dated tile (a completed job naturally stops importing)", () => {
    const staleOrder = makeRForceOrder({
      work_order_number: "WO-100",
      updated_at: "2026-08-06T00:00:00Z",
    });
    const appt = makeAppointment({ work_order_number: "WO-100", scheduled_date: "2026-08-14" });
    // "today" is after the appointment date → past → not flagged.
    expect(deriveDroppedTiles([appt], [staleOrder, recentOrder], [], "2026-08-20")).toHaveLength(0);
  });

  it("does not flag an explicitly cancelled order (handled by Issue Center)", () => {
    const cancelledOrder = makeRForceOrder({
      work_order_number: "WO-100",
      updated_at: "2026-08-06T00:00:00Z",
      wo_status: "Cancelled",
    });
    const appt = makeAppointment({ work_order_number: "WO-100" });
    expect(deriveDroppedTiles([appt], [cancelledOrder, recentOrder], [], TODAY)).toHaveLength(0);
  });

  it("does not flag a tile that has been kept/dismissed", () => {
    const staleOrder = makeRForceOrder({
      work_order_number: "WO-100",
      updated_at: "2026-08-06T00:00:00Z",
    });
    const appt = makeAppointment({ work_order_number: "WO-100", scheduled_date: "2026-08-14" });
    const dismissals = [
      {
        id: "d-1",
        work_order_number: "WO-100",
        rforce_date: "2026-08-14",
        rforce_start_time: null,
        dismissed_by: null,
        dismissed_at: "2026-08-16T00:00:00Z",
        reason: "Kept — verified still scheduled",
      },
    ];
    expect(deriveDroppedTiles([appt], [staleOrder, recentOrder], dismissals, TODAY)).toHaveLength(0);
  });

  it("ignores cancelled/unscheduled appointments", () => {
    const staleOrder = makeRForceOrder({
      work_order_number: "WO-100",
      updated_at: "2026-08-06T00:00:00Z",
    });
    const cancelledAppt = makeAppointment({ work_order_number: "WO-100", status: "cancelled" });
    expect(deriveDroppedTiles([cancelledAppt], [staleOrder, recentOrder], [], TODAY)).toHaveLength(0);
  });
});
