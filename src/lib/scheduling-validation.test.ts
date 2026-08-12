import { describe, it, expect } from "vitest";
import { checkSchedulingConflicts, formatConflictMessage } from "./scheduling-validation";
import { Appointment } from "./types";

// ── Test fixture builder ──

function makeAppt(overrides: Partial<Appointment> & { id: string }): Appointment {
  return {
    crew_id: "crew-1",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "install",
    order_number: null,
    work_order_number: null,
    customer_name: "Test Customer",
    address: "123 Main St, Toledo, OH 43604",
    scheduled_date: "2026-08-10",
    start_time: "08:00",
    end_time: "16:00",
    duration_days: 1,
    time_block: "full_day",
    status: "scheduled",
    notes: null,
    reschedule_reason: null,
    product_count: null,
    salesforce_url: null,
    scheduled_by: null,
    merge_source_wo: null,
    origin: "manual",
    sync_state: "manual_awaiting_rforce",
    original_entry_snapshot: null,
    last_reconciled_import_id: null,
    version: 1,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

describe("checkSchedulingConflicts", () => {
  it("detects same crew, same date, same block conflict", () => {
    const existing = [
      makeAppt({ id: "appt-1", time_block: "9-10", appointment_type: "tech_measure" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "9-10", null, existing
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe("same_block");
  });

  it("returns no conflicts for different blocks", () => {
    const existing = [
      makeAppt({ id: "appt-1", time_block: "9-10", appointment_type: "tech_measure" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "10-12", null, existing
    );
    expect(conflicts).toHaveLength(0);
  });

  it("returns no conflicts for different dates", () => {
    const existing = [
      makeAppt({ id: "appt-1", time_block: "9-10", appointment_type: "tech_measure" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-11", 1, "9-10", null, existing
    );
    expect(conflicts).toHaveLength(0);
  });

  it("returns no conflicts for different crews", () => {
    const existing = [
      makeAppt({ id: "appt-1", time_block: "9-10", appointment_type: "tech_measure" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-2", "2026-08-10", 1, "9-10", null, existing
    );
    expect(conflicts).toHaveLength(0);
  });

  it("skips cancelled appointments", () => {
    const existing = [
      makeAppt({ id: "appt-1", time_block: "9-10", status: "cancelled" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "9-10", null, existing
    );
    expect(conflicts).toHaveLength(0);
  });

  it("skips unscheduled appointments", () => {
    const existing = [
      makeAppt({ id: "appt-1", time_block: "9-10", status: "unscheduled" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "9-10", null, existing
    );
    expect(conflicts).toHaveLength(0);
  });

  it("excludes the appointment being updated", () => {
    const existing = [
      makeAppt({ id: "appt-1", time_block: "9-10" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "9-10", null, existing, "appt-1"
    );
    expect(conflicts).toHaveLength(0);
  });

  // ── Multi-day overlap ──

  it("detects conflict on day 2 of a multi-day appointment", () => {
    const existing = [
      makeAppt({ id: "appt-1", scheduled_date: "2026-08-10", duration_days: 3, time_block: "full_day" }),
    ];
    // Try to schedule on Aug 11 — day 2 of the existing 3-day appointment
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-11", 1, "full_day", null, existing
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe("multi_day_overlap");
    expect(conflicts[0].conflictDate).toBe("2026-08-11");
  });

  it("detects conflict on day 3 of a multi-day appointment", () => {
    const existing = [
      makeAppt({ id: "appt-1", scheduled_date: "2026-08-10", duration_days: 3, time_block: "full_day" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-12", 1, "full_day", null, existing
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictDate).toBe("2026-08-12");
  });

  it("no conflict on the day after multi-day appointment ends", () => {
    const existing = [
      makeAppt({ id: "appt-1", scheduled_date: "2026-08-10", duration_days: 3, time_block: "full_day" }),
    ];
    // Day 4 (Aug 13) should be free
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-13", 1, "full_day", null, existing
    );
    expect(conflicts).toHaveLength(0);
  });

  it("detects when new multi-day appointment overlaps existing single-day", () => {
    const existing = [
      makeAppt({ id: "appt-1", scheduled_date: "2026-08-12", duration_days: 1, time_block: "full_day" }),
    ];
    // New 3-day appointment starting Aug 10 overlaps existing on Aug 12
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 3, "full_day", null, existing
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictDate).toBe("2026-08-12");
  });

  // ── Multi-block overlap ──

  it("detects conflict when existing spans multiple blocks", () => {
    const existing = [
      makeAppt({
        id: "appt-1",
        time_block: "10-12",
        time_block_end: "2-4",
        appointment_type: "tech_measure",
      }),
    ];
    // Try to schedule 12-2 — falls inside existing's 10-12 → 2-4 span
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "12-2", null, existing
    );
    expect(conflicts).toHaveLength(1);
  });

  it("no conflict when outside multi-block span", () => {
    const existing = [
      makeAppt({
        id: "appt-1",
        time_block: "10-12",
        time_block_end: "12-2",
        appointment_type: "tech_measure",
      }),
    ];
    // 4-6 is outside the 10-12 → 12-2 span
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "4-6", null, existing
    );
    expect(conflicts).toHaveLength(0);
  });

  // ── Full-day vs block conflicts ──

  it("full_day conflicts with any measure block", () => {
    const existing = [
      makeAppt({ id: "appt-1", time_block: "full_day" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "9-10", null, existing
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe("full_day_conflict");
  });

  it("measure block conflicts with existing full_day", () => {
    const existing = [
      makeAppt({ id: "appt-1", time_block: "9-10", appointment_type: "tech_measure" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "full_day", null, existing
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe("full_day_conflict");
  });

  // ── Secondary/tertiary crew conflicts ──

  it("detects conflict via secondary_crew_id", () => {
    const existing = [
      makeAppt({ id: "appt-1", crew_id: "crew-2", secondary_crew_id: "crew-1", time_block: "9-10" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "9-10", null, existing
    );
    expect(conflicts).toHaveLength(1);
  });

  it("detects conflict via tertiary_crew_id", () => {
    const existing = [
      makeAppt({ id: "appt-1", crew_id: "crew-2", tertiary_crew_id: "crew-1", time_block: "full_day" }),
    ];
    const conflicts = checkSchedulingConflicts(
      "crew-1", "2026-08-10", 1, "full_day", null, existing
    );
    expect(conflicts).toHaveLength(1);
  });
});

describe("formatConflictMessage", () => {
  it("formats same_block message", () => {
    const msg = formatConflictMessage({
      conflictingAppointmentId: "x",
      customerName: "Smith",
      reason: "same_block",
      conflictDate: "2026-08-10",
      conflictBlock: "9-10",
    });
    expect(msg).toContain("Smith");
    expect(msg).toContain("9-10");
  });

  it("formats multi_day_overlap message", () => {
    const msg = formatConflictMessage({
      conflictingAppointmentId: "x",
      customerName: "Jones",
      reason: "multi_day_overlap",
      conflictDate: "2026-08-11",
      conflictBlock: "full_day",
    });
    expect(msg).toContain("multi-day");
    expect(msg).toContain("Jones");
  });
});
