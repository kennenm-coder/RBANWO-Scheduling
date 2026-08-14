import { describe, it, expect, vi } from "vitest";
import { validateMove, buildMoveUpdates, executeScheduleMove } from "./schedule-command";
import { Appointment, Crew } from "./types";

// ── Test fixtures ──

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
    customer_name: "Smith",
    address: "123 Main St",
    order_number: null,
    work_order_number: null,
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

function makeCrew(overrides: Partial<Crew> = {}): Crew {
  return {
    id: "crew-1",
    name: "Test Crew",
    crew_type: "measure_tech",
    color: "#000",
    is_active: true,
    notes: null,
    aliases: null,
    manages: null,
    additional_types: null,
    primary_crew_id: null,
    sort_order: 0,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    ...overrides,
  } as Crew;
}

const measureCrew = makeCrew({ id: "crew-1", name: "Measure Crew", crew_type: "measure_tech" });
const installCrew = makeCrew({ id: "crew-2", name: "Install Crew", crew_type: "install_in_house" });
const serviceCrew = makeCrew({ id: "crew-3", name: "Service Crew", crew_type: "svc" });
const allCrews = [measureCrew, installCrew, serviceCrew];

describe("validateMove", () => {
  it("returns null for a valid move to an eligible crew", () => {
    const appt = makeAppointment({ appointment_type: "tech_measure" });
    const result = validateMove(
      {
        appointmentId: appt.id,
        expectedVersion: 1,
        crewId: "crew-1",
        scheduledDate: "2026-08-15",
        timeBlock: "9-10",
      },
      appt,
      [appt],
      allCrews
    );
    expect(result).toBeNull();
  });

  it("returns INELIGIBLE_CREW when moving measure to install crew", () => {
    const appt = makeAppointment({ appointment_type: "tech_measure" });
    const result = validateMove(
      {
        appointmentId: appt.id,
        expectedVersion: 1,
        crewId: "crew-2",
        scheduledDate: "2026-08-15",
        timeBlock: "9-10",
      },
      appt,
      [appt],
      allCrews
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INELIGIBLE_CREW");
  });

  it("returns SCHEDULING_CONFLICT when target block is occupied", () => {
    const appt = makeAppointment({ id: "appt-1", appointment_type: "tech_measure", time_block: "10-12" });
    const existing = makeAppointment({
      id: "appt-2",
      crew_id: "crew-1",
      scheduled_date: "2026-08-15",
      time_block: "9-10",
      appointment_type: "tech_measure",
    });
    const result = validateMove(
      {
        appointmentId: appt.id,
        expectedVersion: 1,
        crewId: "crew-1",
        scheduledDate: "2026-08-15",
        timeBlock: "9-10",
      },
      appt,
      [appt, existing],
      allCrews
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe("SCHEDULING_CONFLICT");
  });
});

describe("buildMoveUpdates", () => {
  it("builds fixed_block update with correct times from time block", () => {
    const appt = makeAppointment({ appointment_type: "tech_measure" });
    const updates = buildMoveUpdates(
      {
        appointmentId: appt.id,
        expectedVersion: 1,
        crewId: "crew-1",
        scheduledDate: "2026-08-15",
        timeBlock: "9-10",
      },
      appt,
      allCrews
    );
    expect(updates.time_block).toBe("9-10");
    expect(updates.start_time).toBe("09:00");
    expect(updates.end_time).toBe("10:00");
    expect(updates.scheduled_date).toBe("2026-08-15");
  });

  it("builds timed update preserving original duration", () => {
    const appt = makeAppointment({
      appointment_type: "service",
      start_time: "10:00",
      end_time: "12:00",
    });
    const updates = buildMoveUpdates(
      {
        appointmentId: appt.id,
        expectedVersion: 1,
        crewId: "crew-3",
        scheduledDate: "2026-08-15",
        startTime: "14:00",
      },
      appt,
      allCrews
    );
    expect(updates.start_time).toBe("14:00");
    expect(updates.end_time).toBe("16:00"); // 2 hours preserved
  });

  it("builds full_day update with full_day time block", () => {
    const appt = makeAppointment({
      appointment_type: "install",
      time_block: "full_day",
      duration_days: 3,
    });
    const updates = buildMoveUpdates(
      {
        appointmentId: appt.id,
        expectedVersion: 1,
        crewId: "crew-2",
        scheduledDate: "2026-08-15",
      },
      appt,
      allCrews
    );
    expect(updates.time_block).toBe("full_day");
    expect(updates.duration_days).toBe(3);
  });

  it("sets manual_override when moving linked appointment away from rForce date", () => {
    const appt = makeAppointment({
      work_order_number: "WO-123",
      scheduled_date: "2026-08-14",
    });
    const rf = {
      work_order_number: "WO-123",
      scheduled_start: "2026-08-14T10:00:00",
      primary_resource: "Measure Crew",
    } as any;
    const updates = buildMoveUpdates(
      {
        appointmentId: appt.id,
        expectedVersion: 1,
        crewId: "crew-1",
        scheduledDate: "2026-08-20", // Different from rForce date
      },
      appt,
      allCrews,
      [rf]
    );
    expect(updates.manual_override).toBe(true);
    expect(updates.override_source).toBeTruthy();
  });

  it("clears manual_override when moving back to match rForce", () => {
    const appt = makeAppointment({
      work_order_number: "WO-123",
      scheduled_date: "2026-08-20",
      manual_override: true,
      override_source: { scheduled_date: "2026-08-14" },
    });
    const rf = {
      work_order_number: "WO-123",
      scheduled_start: "2026-08-14T10:00:00",
      primary_resource: "Measure Crew",
    } as any;
    const updates = buildMoveUpdates(
      {
        appointmentId: appt.id,
        expectedVersion: 1,
        crewId: "crew-1",
        scheduledDate: "2026-08-14", // Matches rForce
      },
      appt,
      allCrews,
      [rf]
    );
    expect(updates.manual_override).toBe(false);
    expect(updates.override_source).toBeNull();
  });
});

describe("executeScheduleMove", () => {
  it("commits scheduling and descriptive edits in one update", async () => {
    const appt = makeAppointment({ customer_name: "Old Name" });
    const update = vi.fn().mockImplementation(async (_id, version, changes) => ({
      ...appt,
      ...changes,
      version: version + 1,
    }));
    const result = await executeScheduleMove(
      {
        appointmentId: appt.id,
        expectedVersion: appt.version,
        crewId: appt.crew_id!,
        scheduledDate: "2026-08-15",
        timeBlock: "9-10",
        additionalUpdates: { customer_name: "New Name", notes: "Updated once" },
        auditAction: "updated",
      },
      appt,
      [appt],
      allCrews,
      [],
      update,
      { id: null, name: "Scheduler" }
    );

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][2]).toMatchObject({
      scheduled_date: "2026-08-15",
      customer_name: "New Name",
      notes: "Updated once",
    });
  });
});
