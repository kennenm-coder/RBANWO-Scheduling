import { describe, it, expect } from "vitest";
import { deriveRForceCalendarStatus, RForceCalendarItem } from "./rforce-calendar-status";
import { Appointment, RForceOrder, AppointmentLink, Crew } from "./types";

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
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "tech_measure",
    scheduled_date: "2026-08-14",
    start_time: "10:00",
    end_time: "12:00",
    time_block: "10-12",
    duration_days: 1,
    customer_name: "Test Customer",
    address: "123 Main St",
    order_number: null,
    work_order_number: "WO-100",
    product_count: null,
    notes: null,
    status: "scheduled",
    origin: "manual",
    sync_state: null,
    version: 1,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    manual_override: false,
    override_source: null,
    salesforce_url: null,
    scheduled_by: null,
    reschedule_reason: null,
    merge_source_wo: null,
    time_block_end: null,
    original_entry_snapshot: null,
    last_reconciled_import_id: null,
    ...overrides,
  } as Appointment;
}

const crews: Crew[] = [
  { id: "crew-1", name: "Crew A", crew_type: "measure_tech", color: "#000", is_active: true, notes: null, aliases: null, manages: null, additional_types: null, primary_crew_id: null, sort_order: 0, created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z" } as Crew,
  { id: "crew-2", name: "Crew B", crew_type: "install_in_house", color: "#000", is_active: true, notes: null, aliases: null, manages: null, additional_types: null, primary_crew_id: null, sort_order: 1, created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z" } as Crew,
];

describe("deriveRForceCalendarStatus", () => {
  it("returns needs_confirmation when rForce order is scheduled but no local appointment exists", () => {
    const rf = makeRForceOrder({ scheduled_start: "2026-08-14T10:00:00" });
    const result = deriveRForceCalendarStatus([rf], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("needs_confirmation");
  });

  it("returns reference when rForce order has no scheduled_start", () => {
    const rf = makeRForceOrder({ scheduled_start: null as any });
    const result = deriveRForceCalendarStatus([rf], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("reference");
  });

  it("returns synced when linked appointment matches rForce", () => {
    const rf = makeRForceOrder({ scheduled_start: "2026-08-14T10:00:00", primary_resource: "Crew A" });
    const appt = makeAppointment({ crew_id: "crew-1", scheduled_date: "2026-08-14", start_time: "10:00" });
    const result = deriveRForceCalendarStatus([rf], [appt], [], crews);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("synced");
    expect(result[0].linkedAppointment?.id).toBe("appt-1");
  });

  it("returns mismatch when dates differ", () => {
    const rf = makeRForceOrder({ scheduled_start: "2026-08-14T10:00:00" });
    const appt = makeAppointment({ scheduled_date: "2026-08-20", start_time: "10:00" });
    const result = deriveRForceCalendarStatus([rf], [appt], [], crews);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("mismatch");
    expect(result[0].mismatchDetails?.date).toEqual({
      app: "2026-08-20",
      rforce: "2026-08-14",
    });
  });

  it("returns mismatch when times differ", () => {
    const rf = makeRForceOrder({ scheduled_start: "2026-08-14T10:00:00" });
    const appt = makeAppointment({ scheduled_date: "2026-08-14", start_time: "14:00" });
    const result = deriveRForceCalendarStatus([rf], [appt], [], crews);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("mismatch");
    expect(result[0].mismatchDetails?.time).toEqual({
      app: "14:00",
      rforce: "10:00",
    });
  });

  it("returns mismatch when crew/resource differs", () => {
    const rf = makeRForceOrder({
      scheduled_start: "2026-08-14T10:00:00",
      primary_resource: "Crew B",
    });
    const appt = makeAppointment({ scheduled_date: "2026-08-14", start_time: "10:00", crew_id: "crew-1" });
    const result = deriveRForceCalendarStatus([rf], [appt], [], crews);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("mismatch");
    expect(result[0].mismatchDetails?.crew).toEqual({
      app: "Crew A",
      rforce: "Crew B",
    });
  });

  it("links via AppointmentLink when WO matches", () => {
    const rf = makeRForceOrder({ work_order_number: "WO-200" });
    const appt = makeAppointment({ id: "appt-linked", work_order_number: "WO-OTHER", scheduled_date: "2026-08-14", start_time: "10:00" });
    const link: AppointmentLink = {
      id: "link-1",
      appointment_id: "appt-linked",
      work_order_number: "WO-200",
      linked_at: "2026-08-14T00:00:00Z",
      unlinked_at: null,
    } as AppointmentLink;
    const result = deriveRForceCalendarStatus([rf], [appt], [link], crews);
    expect(result).toHaveLength(1);
    expect(result[0].linkedAppointment?.id).toBe("appt-linked");
  });

  it("ignores unlinked (broken) appointment links", () => {
    const rf = makeRForceOrder({ work_order_number: "WO-200" });
    const appt = makeAppointment({ id: "appt-unlinked", work_order_number: "WO-OTHER" });
    const link: AppointmentLink = {
      id: "link-1",
      appointment_id: "appt-unlinked",
      work_order_number: "WO-200",
      linked_at: "2026-08-14T00:00:00Z",
      unlinked_at: "2026-08-14T01:00:00Z", // Unlinked
    } as AppointmentLink;
    const result = deriveRForceCalendarStatus([rf], [appt], [link]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("needs_confirmation");
    expect(result[0].linkedAppointment).toBeUndefined();
  });

  it("skips cancelled appointments when looking for WO matches", () => {
    const rf = makeRForceOrder({ work_order_number: "WO-100" });
    const cancelledAppt = makeAppointment({ status: "cancelled", work_order_number: "WO-100" });
    const result = deriveRForceCalendarStatus([rf], [cancelledAppt], []);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("needs_confirmation");
  });

  it("matches work-order identity regardless of case and surrounding whitespace", () => {
    const rf = makeRForceOrder({ work_order_number: " wo-100 " });
    const appt = makeAppointment({ work_order_number: "WO-100" });
    expect(deriveRForceCalendarStatus([rf], [appt], [], crews)[0].linkedAppointment?.id)
      .toBe(appt.id);
  });

  it("accepts a configured crew alias without reporting a resource mismatch", () => {
    const aliasedCrews = [{ ...crews[0], aliases: ["RF Crew Alpha"] }, crews[1]];
    const rf = makeRForceOrder({ primary_resource: "rf crew alpha" });
    const appt = makeAppointment({ crew_id: "crew-1" });
    expect(deriveRForceCalendarStatus([rf], [appt], [], aliasedCrews)[0].status)
      .toBe("synced");
  });
});
