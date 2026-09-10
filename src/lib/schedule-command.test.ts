import { describe, it, expect, vi } from "vitest";
import { validateMove, buildMoveUpdates, executeScheduleMove, resolveMoveTimes } from "./schedule-command";
import { Appointment, AvailabilityRule, Crew } from "./types";

function makeAvailabilityRule(overrides: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return {
    id: "rule-1",
    crew_id: "crew-1",
    kind: "office_day",
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

  it("returns AVAILABILITY_CONFLICT when moving onto an all-day office day", () => {
    const appt = makeAppointment({ appointment_type: "tech_measure" });
    const rule = makeAvailabilityRule({
      kind: "office_day",
      crew_id: "crew-1",
      effective_start: "2026-08-15",
      effective_end: "2026-08-15",
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
      [appt],
      allCrews,
      [rule],
      []
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe("AVAILABILITY_CONFLICT");
  });

  it("allows the move onto a blocked day when the override is set", () => {
    const appt = makeAppointment({ appointment_type: "tech_measure" });
    const rule = makeAvailabilityRule({
      kind: "office_day",
      crew_id: "crew-1",
      effective_start: "2026-08-15",
      effective_end: "2026-08-15",
    });
    const result = validateMove(
      {
        appointmentId: appt.id,
        expectedVersion: 1,
        crewId: "crew-1",
        scheduledDate: "2026-08-15",
        timeBlock: "9-10",
        allowAvailabilityConflict: true,
      },
      appt,
      [appt],
      allCrews,
      [rule],
      []
    );
    expect(result).toBeNull();
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

  it("tags allow_availability_conflict from the target override", () => {
    const appt = makeAppointment({ appointment_type: "tech_measure" });
    const base = {
      appointmentId: appt.id,
      expectedVersion: 1,
      crewId: "crew-1",
      scheduledDate: "2026-08-15",
      timeBlock: "9-10" as const,
    };
    expect(buildMoveUpdates(base, appt, allCrews).allow_availability_conflict).toBe(false);
    expect(
      buildMoveUpdates({ ...base, allowAvailabilityConflict: true }, appt, allCrews)
        .allow_availability_conflict
    ).toBe(true);
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

describe("multi-block measure spans survive moves correctly (audit C1)", () => {
  const crews = [makeCrew({ id: "crew-1" }), makeCrew({ id: "crew-2", name: "Other Tech" })];
  // A measure spanning 10-12 → 2-4 (three blocks) on crew-1.
  const spanning = makeAppointment({
    id: "span",
    crew_id: "crew-1",
    time_block: "10-12",
    time_block_end: "2-4",
    start_time: "10:00",
    end_time: "16:00",
  });

  it("keeps the span on a crew change and stores the end of the LAST block", () => {
    const r = resolveMoveTimes(
      { appointmentId: "span", expectedVersion: 1, crewId: "crew-2", scheduledDate: "2026-08-14", timeBlock: "10-12" },
      spanning
    );
    expect(r.timeBlock).toBe("10-12");
    expect(r.timeBlockEnd).toBe("2-4");
    expect(r.startTime).toBe("10:00");
    expect(r.endTime).toBe("16:00"); // was 12:00 — only block one — before the fix
  });

  it("detects a conflict on block TWO of the span when moved onto another crew", () => {
    // crew-2 already has a measure in 12-2, the middle of the span.
    const blocker = makeAppointment({ id: "blocker", crew_id: "crew-2", time_block: "12-2", start_time: "12:00", end_time: "14:00" });
    const err = validateMove(
      { appointmentId: "span", expectedVersion: 1, crewId: "crew-2", scheduledDate: "2026-08-14", timeBlock: "10-12" },
      spanning,
      [spanning, blocker],
      crews
    );
    expect(err?.code).toBe("SCHEDULING_CONFLICT");
  });

  it("slides the span when the start block changes and it still fits", () => {
    const r = resolveMoveTimes(
      { appointmentId: "span", expectedVersion: 1, crewId: "crew-1", scheduledDate: "2026-08-14", timeBlock: "12-2" },
      spanning
    );
    expect(r.timeBlockEnd).toBe("4-6");
    expect(r.endTime).toBe("18:00");
  });

  it("drops the span (never inverts it) when the slide would run off the grid", () => {
    const r = resolveMoveTimes(
      { appointmentId: "span", expectedVersion: 1, crewId: "crew-1", scheduledDate: "2026-08-14", timeBlock: "4-6" },
      spanning
    );
    expect(r.timeBlockEnd).toBeNull();
    expect(r.endTime).toBe("18:00");
  });

  it("an explicit null clears the span", () => {
    const r = resolveMoveTimes(
      { appointmentId: "span", expectedVersion: 1, crewId: "crew-1", scheduledDate: "2026-08-14", timeBlock: "10-12", timeBlockEnd: null },
      spanning
    );
    expect(r.timeBlockEnd).toBeNull();
    expect(r.endTime).toBe("12:00");
  });
});

describe("a measure is never stored as full_day (audit C2)", () => {
  it("coerces a full_day target block to the first measure block", () => {
    const measure = makeAppointment({ time_block: null, start_time: null as any, end_time: null as any });
    const r = resolveMoveTimes(
      { appointmentId: "appt-1", expectedVersion: 1, crewId: "crew-1", scheduledDate: "2026-08-14", timeBlock: "full_day" },
      measure
    );
    expect(r.timeBlock).toBe("9-10");
    expect(r.wantsFullDay).toBe(false);
  });
});

describe("time-window sanity (audit H5)", () => {
  const svcCrew = makeCrew({ id: "crew-svc", crew_type: "svc" });
  const service = makeAppointment({ id: "svc", appointment_type: "service", crew_id: "crew-svc", time_block: null, start_time: "09:00", end_time: "10:00" });

  it("rejects an end at or before the start with INVALID_TIME_RANGE, not a conflict", () => {
    const err = validateMove(
      { appointmentId: "svc", expectedVersion: 1, crewId: "crew-svc", scheduledDate: "2026-08-14", startTime: "17:00", endTime: "09:00" },
      service,
      [service],
      [svcCrew]
    );
    expect(err?.code).toBe("INVALID_TIME_RANGE");
  });

  it("a full-day flip from a late timed start uses the canonical workday instead of inverting", () => {
    const install = makeAppointment({ id: "inst", appointment_type: "install", start_time: "17:00", end_time: "18:00", time_block: null });
    const r = resolveMoveTimes(
      { appointmentId: "inst", expectedVersion: 1, crewId: "crew-1", scheduledDate: "2026-08-14", isFullDay: true, startTime: "17:00" },
      install
    );
    expect(r.startTime).toBe("08:00");
    expect(r.endTime).toBe("16:00");
    expect(r.timeBlock).toBe("full_day");
  });
});

describe("placing a queued tile schedules it (audit H2)", () => {
  it("flips status to scheduled when the current row is unscheduled", () => {
    const queued = makeAppointment({ id: "q", status: "unscheduled", crew_id: null, scheduled_date: null, time_block: null });
    const updates = buildMoveUpdates(
      { appointmentId: "q", expectedVersion: 1, crewId: "crew-1", scheduledDate: "2026-08-14", timeBlock: "10-12" },
      queued,
      [makeCrew()]
    );
    expect(updates.status).toBe("scheduled");
    expect(updates.crew_id).toBe("crew-1");
  });

  it("does not touch status on an already-scheduled row", () => {
    const updates = buildMoveUpdates(
      { appointmentId: "appt-1", expectedVersion: 1, crewId: "crew-1", scheduledDate: "2026-08-15", timeBlock: "10-12" },
      makeAppointment(),
      [makeCrew()]
    );
    expect(updates.status).toBeUndefined();
  });
});

describe("overrides survive notes-only edits; timed moves are checked (audit M5 / H4)", () => {
  const crews = [makeCrew({ id: "crew-1" })];

  it("a notes-only edit of an intentionally-overlapped tile is not re-judged and keeps its override", () => {
    const mine = makeAppointment({ id: "mine", allow_overlap: true }); // 10-12 on crew-1
    const other = makeAppointment({ id: "other", time_block: "10-12" }); // the overlap that was approved
    const target = {
      appointmentId: "mine",
      expectedVersion: 1,
      crewId: "crew-1",
      scheduledDate: "2026-08-14",
      timeBlock: "10-12" as const,
      additionalUpdates: { notes: "gate code 1234", secondary_crew_id: null, tertiary_crew_id: null },
    };
    expect(validateMove(target, mine, [mine, other], crews)).toBeNull();
    expect(buildMoveUpdates(target, mine, crews).allow_overlap).toBe(true);
  });

  it("moving that tile to a new slot re-arms the guard (override cleared)", () => {
    const mine = makeAppointment({ id: "mine", allow_overlap: true });
    const updates = buildMoveUpdates(
      { appointmentId: "mine", expectedVersion: 1, crewId: "crew-1", scheduledDate: "2026-08-15", timeBlock: "10-12" },
      mine,
      crews
    );
    expect(updates.allow_overlap).toBe(false);
  });

  it("a service moved onto another service's window is a conflict (timed jobs were invisible before)", () => {
    const svcCrew = makeCrew({ id: "crew-svc", crew_type: "svc" });
    const a = makeAppointment({ id: "a", appointment_type: "service", crew_id: "crew-svc", time_block: null, start_time: "09:00", end_time: "11:00" });
    const b = makeAppointment({ id: "b", appointment_type: "service", crew_id: "crew-svc", time_block: null, start_time: "13:00", end_time: "14:00" });
    const err = validateMove(
      { appointmentId: "b", expectedVersion: 1, crewId: "crew-svc", scheduledDate: "2026-08-14", startTime: "10:00", endTime: "12:00" },
      b,
      [a, b],
      [svcCrew]
    );
    expect(err?.code).toBe("SCHEDULING_CONFLICT");
    expect(err?.message).toContain("09:00–11:00");
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
