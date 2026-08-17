/**
 * Tests that scheduling conflict prevention is wired into store write functions.
 *
 * These tests verify the pre-write contract: when existingAppointments is provided,
 * createAppointment, updateAppointment, and approveRForceOrder must reject
 * conflicting schedules before hitting the database.
 *
 * The actual conflict detection logic (multi-day, multi-block, full-day, secondary crew)
 * is tested exhaustively in scheduling-validation.test.ts. These tests confirm the
 * store functions actually call it and throw the right error shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Appointment, TimeBlock } from "./types";

// Mock Supabase so we never hit a real database
vi.mock("./supabase", () => ({
  requireSupabase: () => ({
    from: () => ({
      // Existing-work-order lookup performed by approveRForceOrder before it
      // decides whether to place a queued tile or create a new one. Returns no
      // candidates so the conflict-check / create path is exercised.
      select: () => ({
        neq: () => ({
          ilike: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: null, error: { code: "mock", message: "should not reach DB" } }),
        }),
      }),
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: null, error: { code: "mock", message: "should not reach DB" } }),
            }),
          }),
        }),
      }),
    }),
  }),
  getSupabase: () => null,
}));

// Mock resource-learning to avoid DB calls from approveRForceOrder
vi.mock("./resource-learning", () => ({
  learnResourceMapping: () => {},
}));

import { createAppointment, updateAppointment, approveRForceOrder } from "./store";

function makeAppt(overrides: Partial<Appointment> & { id: string }): Appointment {
  return {
    crew_id: "crew-1",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "install",
    order_number: null,
    work_order_number: null,
    customer_name: "Existing Customer",
    address: "123 Main St",
    scheduled_date: "2026-08-15",
    start_time: "08:00",
    end_time: "16:00",
    duration_days: 1,
    time_block: "full_day" as TimeBlock,
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
    created_at: "2026-08-15T00:00:00Z",
    updated_at: "2026-08-15T00:00:00Z",
    ...overrides,
  };
}

describe("createAppointment conflict prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws SCHEDULING_CONFLICT when a conflict exists", async () => {
    const existing = [makeAppt({ id: "existing-1" })];

    // Try to create an appointment on the same crew, same date, same block
    await expect(
      createAppointment(
        {
          crew_id: "crew-1",
          secondary_crew_id: null,
          tertiary_crew_id: null,
          appointment_type: "install",
          order_number: null,
          work_order_number: null,
          customer_name: "New Customer",
          address: "456 Oak Ave",
          scheduled_date: "2026-08-15",
          start_time: "08:00",
          end_time: "16:00",
          duration_days: 1,
          time_block: "full_day" as TimeBlock,
          status: "scheduled",
          notes: null,
          reschedule_reason: null,
          product_count: null,
          salesforce_url: null,
          scheduled_by: null,
          merge_source_wo: null,
        },
        existing
      )
    ).rejects.toThrow("SCHEDULING_CONFLICT");
  });

  it("does not throw when no conflict exists", async () => {
    const existing = [makeAppt({ id: "existing-1" })];

    // Different date — no conflict (will fail at DB mock, but won't throw SCHEDULING_CONFLICT)
    await expect(
      createAppointment(
        {
          crew_id: "crew-1",
          secondary_crew_id: null,
          tertiary_crew_id: null,
          appointment_type: "install",
          order_number: null,
          work_order_number: null,
          customer_name: "New Customer",
          address: "456 Oak Ave",
          scheduled_date: "2026-08-16", // different date
          start_time: "08:00",
          end_time: "16:00",
          duration_days: 1,
          time_block: "full_day" as TimeBlock,
          status: "scheduled",
          notes: null,
          reschedule_reason: null,
          product_count: null,
          salesforce_url: null,
          scheduled_by: null,
          merge_source_wo: null,
        },
        existing
      )
    ).rejects.not.toThrow("SCHEDULING_CONFLICT");
  });

  it("skips validation when existingAppointments is not provided (backward compat)", async () => {
    // Without existingAppointments, the function hits the DB directly (mock will error)
    // This confirms the parameter is optional and doesn't break existing callers
    await expect(
      createAppointment({
        crew_id: "crew-1",
        secondary_crew_id: null,
        tertiary_crew_id: null,
        appointment_type: "install",
        order_number: null,
        work_order_number: null,
        customer_name: "New Customer",
        address: "456 Oak Ave",
        scheduled_date: "2026-08-15",
        start_time: "08:00",
        end_time: "16:00",
        duration_days: 1,
        time_block: "full_day" as TimeBlock,
        status: "scheduled",
        notes: null,
        reschedule_reason: null,
        product_count: null,
        salesforce_url: null,
        scheduled_by: null,
        merge_source_wo: null,
      })
      // No existingAppointments — should NOT throw SCHEDULING_CONFLICT
    ).rejects.not.toThrow("SCHEDULING_CONFLICT");
  });
});

describe("updateAppointment conflict prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws SCHEDULING_CONFLICT when rescheduling into a conflict", async () => {
    const existing = [
      makeAppt({ id: "a1", scheduled_date: "2026-08-15", time_block: "full_day" }),
      makeAppt({ id: "a2", scheduled_date: "2026-08-16", time_block: "full_day" }),
    ];

    // Move a2 to the same date/block as a1
    await expect(
      updateAppointment(
        "a2",
        1,
        { scheduled_date: "2026-08-15", time_block: "full_day" as TimeBlock },
        existing
      )
    ).rejects.toThrow("SCHEDULING_CONFLICT");
  });

  it("allows moving to a non-conflicting slot", async () => {
    const existing = [
      makeAppt({ id: "a1", scheduled_date: "2026-08-15", time_block: "full_day" }),
      makeAppt({ id: "a2", scheduled_date: "2026-08-16", time_block: "full_day" }),
    ];

    // Move a2 to a different date with no conflicts — will hit DB mock but not SCHEDULING_CONFLICT
    await expect(
      updateAppointment(
        "a2",
        1,
        { scheduled_date: "2026-08-17", time_block: "full_day" as TimeBlock },
        existing
      )
    ).rejects.not.toThrow("SCHEDULING_CONFLICT");
  });
});

describe("approveRForceOrder conflict prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws SCHEDULING_CONFLICT when approving into a conflict", async () => {
    const existing = [makeAppt({ id: "existing-1" })];

    const rforceOrder = {
      id: "rf-1",
      order_number: "ORD-100",
      work_order_number: "WO-100",
      order_status: "Scheduled",
      wo_status: "Open",
      work_order_type: "Install",
      customer_name: "rForce Customer",
      address: "789 Elm St",
      booking_date: null,
      scheduled_start: "2026-08-15T08:00:00",
      scheduled_end: "2026-08-15T16:00:00",
      description: null,
      combined_retail_total: null,
      product_count: 5,
      total_units: null,
      windows: null,
      patio_doors: null,
      doors: null,
      order_owner: null,
      sales_rep: null,
      primary_resource: null,
      tech_measure_name: null,
      installer: null,
      service_rep: null,
      contact_name: null,
      email: null,
      phones: null,
      order_alerts: null,
      scheduler_notes: null,
      account_name: null,
      csv_import_id: null,
      latitude: null,
      longitude: null,
      updated_at: "2026-08-15T00:00:00Z",
    };

    // Same crew, same date, same block as existing
    await expect(
      approveRForceOrder(
        rforceOrder,
        "crew-1",
        "full_day" as TimeBlock,
        "2026-08-15",
        null,
        null,
        existing
      )
    ).rejects.toThrow("SCHEDULING_CONFLICT");
  });
});
