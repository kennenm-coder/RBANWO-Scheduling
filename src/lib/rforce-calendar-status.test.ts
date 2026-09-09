import { describe, it, expect } from "vitest";
import {
  deriveRForceCalendarStatus,
  deriveAppointmentRForceState,
  RForceCalendarItem,
} from "./rforce-calendar-status";
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

describe("awaiting rForce (booked in the app before rForce caught up)", () => {
  it("install paired with a Tech Measure row is awaiting_rforce, not a mismatch", () => {
    // rForce keeps ONE row per WO; after the measure it still says "Tech Measure"
    // with the measure date. Comparing the install's date against it would be a
    // false "Schedule differs".
    const rf = makeRForceOrder({ work_order_type: "Tech Measure", scheduled_start: "2026-08-14T10:00:00" });
    const install = makeAppointment({
      id: "appt-install",
      appointment_type: "install",
      scheduled_date: "2026-09-15",
      crew_id: "crew-2",
      time_block: "full_day",
    });
    const [item] = deriveRForceCalendarStatus([rf], [install], [], crews);
    expect(item.status).toBe("awaiting_rforce");
    expect(item.linkedAppointment?.id).toBe("appt-install");
    expect(item.mismatchDetails).toBeUndefined();
  });

  it("a row with no scheduled_start is awaiting_rforce", () => {
    const rf = makeRForceOrder({ scheduled_start: null as any });
    const [item] = deriveRForceCalendarStatus([rf], [makeAppointment()], [], crews);
    expect(item.status).toBe("awaiting_rforce");
  });

  it("a same-phase row on a different date is still a mismatch", () => {
    const rf = makeRForceOrder({ work_order_type: "Tech Measure", scheduled_start: "2026-08-14T10:00:00" });
    const appt = makeAppointment({ scheduled_date: "2026-08-15" });
    const [item] = deriveRForceCalendarStatus([rf], [appt], [], crews);
    expect(item.status).toBe("mismatch");
    expect(item.mismatchDetails?.date).toBeDefined();
  });

  it("an unrecognized rForce type still goes through normal comparison", () => {
    const rf = makeRForceOrder({ work_order_type: "Mystery" });
    const [item] = deriveRForceCalendarStatus([rf], [makeAppointment()], [], crews);
    expect(item.status).toBe("synced");
  });

  it("pairs the row with the tile whose type matches its phase when a WO is shared", () => {
    const rf = makeRForceOrder({ work_order_type: "Tech Measure" });
    // Install listed first: the legacy "first tile on the WO" rule would pick it.
    const install = makeAppointment({ id: "appt-install", appointment_type: "install", scheduled_date: "2026-09-15", crew_id: "crew-2" });
    const measure = makeAppointment({ id: "appt-measure" });
    const [item] = deriveRForceCalendarStatus([rf], [install, measure], [], crews);
    expect(item.linkedAppointment?.id).toBe("appt-measure");
    expect(item.status).toBe("synced");
  });
});

describe("deriveAppointmentRForceState", () => {
  const today = "2026-09-01";
  const byWo = (rfs: RForceOrder[]) =>
    new Map(rfs.map((rf) => [rf.work_order_number.toLowerCase(), rf]));
  const upcomingInstall = (overrides: Partial<Appointment> = {}) =>
    makeAppointment({
      id: "appt-install",
      appointment_type: "install",
      scheduled_date: "2026-09-15",
      updated_at: "2026-09-01T12:00:00Z",
      ...overrides,
    });

  it("no rForce row → not_in_rforce, pending while there's no export history", () => {
    const state = deriveAppointmentRForceState(upcomingInstall({ work_order_number: "WO-999" }), byWo([]), [], today);
    expect(state).toEqual({ reason: "not_in_rforce", tier: "pending", missedExports: 0, rforceOrder: undefined });
  });

  it("escalates to overdue once an export is newer than the booking", () => {
    const state = deriveAppointmentRForceState(upcomingInstall({ work_order_number: "WO-999" }), byWo([]), ["2026-09-02"], today);
    expect(state?.tier).toBe("overdue");
    expect(state?.missedExports).toBe(1);
  });

  it("a same-day export does not count (exports run before bookings that day)", () => {
    const state = deriveAppointmentRForceState(upcomingInstall({ work_order_number: "WO-999" }), byWo([]), ["2026-09-01"], today);
    expect(state?.tier).toBe("pending");
  });

  it("measure-phase row → phase_not_scheduled with the row attached", () => {
    const rf = makeRForceOrder({ work_order_type: "Tech Measure" });
    const state = deriveAppointmentRForceState(upcomingInstall(), byWo([rf]), [], today);
    expect(state?.reason).toBe("phase_not_scheduled");
    expect(state?.rforceOrder).toBe(rf);
  });

  it("returns null for reflected, past-dated, no-WO, and cancelled tiles", () => {
    const rf = makeRForceOrder({ work_order_type: "Tech Measure" });
    const reflectedMeasure = makeAppointment({ scheduled_date: "2026-09-15" });
    expect(deriveAppointmentRForceState(reflectedMeasure, byWo([rf]), [], today)).toBeNull();
    expect(deriveAppointmentRForceState(upcomingInstall({ scheduled_date: "2026-08-01" }), byWo([rf]), [], today)).toBeNull();
    expect(deriveAppointmentRForceState(upcomingInstall({ work_order_number: null }), byWo([rf]), [], today)).toBeNull();
    expect(deriveAppointmentRForceState(upcomingInstall({ status: "cancelled" }), byWo([rf]), [], today)).toBeNull();
  });

  it("rForce status: cancelled → null; completed only hides the SAME phase", () => {
    const cancelled = makeRForceOrder({ work_order_type: "Tech Measure", wo_status: "Cancelled" });
    expect(deriveAppointmentRForceState(upcomingInstall(), byWo([cancelled]), [], today)).toBeNull();

    // Row closed after the measure — the install was still never entered.
    const measureDone = makeRForceOrder({ work_order_type: "Tech Measure", wo_status: "Appt Complete / Closed" });
    expect(deriveAppointmentRForceState(upcomingInstall(), byWo([measureDone]), [], today)?.reason).toBe("phase_not_scheduled");

    const installDone = makeRForceOrder({ work_order_type: "Install", wo_status: "Appt Complete / Closed" });
    expect(deriveAppointmentRForceState(upcomingInstall(), byWo([installDone]), [], today)).toBeNull();
  });
});

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

  it("returns mismatch when the rForce time lands in a different block", () => {
    // rForce 10:00 → 10-12 block, but the appointment sits in the 2-4 block.
    const rf = makeRForceOrder({ scheduled_start: "2026-08-14T10:00:00" });
    const appt = makeAppointment({ scheduled_date: "2026-08-14", start_time: "14:00", time_block: "2-4" });
    const result = deriveRForceCalendarStatus([rf], [appt], [], crews);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("mismatch");
    expect(result[0].mismatchDetails?.time).toEqual({
      app: "2-4",
      rforce: "10-12",
    });
  });

  it("stays in sync when the rForce time is within the same block (block-aware)", () => {
    // rForce 10:30 falls inside the 10-12 block → not a mismatch even though the
    // stored start_time (10:00) differs from the exact minute.
    const rf = makeRForceOrder({ scheduled_start: "2026-08-14T10:30:00" });
    const appt = makeAppointment({ scheduled_date: "2026-08-14", start_time: "10:00", time_block: "10-12" });
    const result = deriveRForceCalendarStatus([rf], [appt], [], crews);
    expect(result[0].status).toBe("synced");
    expect(result[0].mismatchDetails).toBeUndefined();
  });

  it("returns a duration mismatch when rForce spans more days than the appointment", () => {
    // rForce is a 2-day job (9/14–9/15); the appointment is booked for 1 day.
    const rf = makeRForceOrder({
      scheduled_start: "2026-09-14T08:00:00",
      scheduled_end: "2026-09-15T16:00:00",
    });
    const appt = makeAppointment({
      scheduled_date: "2026-09-14",
      duration_days: 1,
      start_time: "08:00",
      time_block: "full_day",
    });
    const result = deriveRForceCalendarStatus([rf], [appt], [], crews);
    expect(result[0].status).toBe("mismatch");
    expect(result[0].mismatchDetails?.duration).toEqual({ app: 1, rforce: 2 });
  });

  it("stays synced when the rForce span matches the appointment duration", () => {
    const rf = makeRForceOrder({
      scheduled_start: "2026-09-14T08:00:00",
      scheduled_end: "2026-09-15T16:00:00",
    });
    const appt = makeAppointment({
      scheduled_date: "2026-09-14",
      duration_days: 2,
      start_time: "08:00",
      time_block: "full_day",
    });
    const result = deriveRForceCalendarStatus([rf], [appt], [], crews);
    expect(result[0].status).toBe("synced");
  });

  it("awaits rForce when Primary Resource is blank despite old job contacts and dates", () => {
    const rf = makeRForceOrder({ primary_resource: " ", installer: "Old Installer", service_rep: "Old Service", scheduled_start: "2026-08-01T10:00:00" });
    const appt = makeAppointment({ scheduled_date: "2026-08-14" });
    const result = deriveRForceCalendarStatus([rf], [appt], [], crews);
    expect(result[0].status).toBe("awaiting_rforce");
    expect(result[0].mismatchDetails).toBeUndefined();
    expect(deriveRForceCalendarStatus([rf], [], [], crews)[0].status).toBe("reference");
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
