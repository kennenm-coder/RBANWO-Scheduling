import { describe, it, expect } from "vitest";
import { deriveIssues } from "./issues";
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
