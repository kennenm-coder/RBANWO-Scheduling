import { describe, it, expect } from "vitest";
import { buildMergeUpdates } from "./merge";
import type { Appointment, RForceOrder } from "./types";

function makeAppt(overrides: Partial<Appointment> & { id: string }): Appointment {
  return {
    crew_id: "crew-1",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "install",
    order_number: null,
    work_order_number: null,
    customer_name: "John Doe",
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

function makeRF(overrides: Partial<RForceOrder> = {}): RForceOrder {
  return {
    id: "rf-1",
    order_number: "ORD-100",
    work_order_number: "WO-100",
    order_status: "Scheduled",
    wo_status: "Open",
    work_order_type: "Install",
    customer_name: "Jane Smith",
    address: "456 Oak Ave, Toledo, OH 43604",
    booking_date: null,
    scheduled_start: "2026-08-10T08:00:00",
    scheduled_end: "2026-08-10T16:00:00",
    description: "Window replacement",
    combined_retail_total: null,
    product_count: 5,
    total_units: null,
    windows: null,
    patio_doors: null,
    doors: null,
    order_owner: null,
    sales_rep: null,
    primary_resource: "Crew Alpha",
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
    updated_at: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

describe("buildMergeUpdates", () => {
  it("applies rForce-wins fields (WO#, order#, address, customer, product_count)", () => {
    const appt = makeAppt({ id: "a1" });
    const rf = makeRF();

    const { updates, fieldsUpdated } = buildMergeUpdates(appt, rf);

    expect(updates.work_order_number).toBe("WO-100");
    expect(updates.order_number).toBe("ORD-100");
    expect(updates.address).toBe("456 Oak Ave, Toledo, OH 43604");
    expect(updates.customer_name).toBe("Jane Smith");
    expect(updates.product_count).toBe(5);
    expect(fieldsUpdated).toContain("work_order_number");
    expect(fieldsUpdated).toContain("address");
    expect(fieldsUpdated).toContain("customer_name");
    expect(fieldsUpdated).toContain("product_count");
  });

  it("preserves manual scheduling fields (not in updates)", () => {
    const appt = makeAppt({ id: "a1" });
    const rf = makeRF();

    const { updates } = buildMergeUpdates(appt, rf);

    // crew_id, scheduled_date, time_block, start_time, end_time are manual-wins
    expect(updates).not.toHaveProperty("crew_id");
    expect(updates).not.toHaveProperty("scheduled_date");
    expect(updates).not.toHaveProperty("time_block");
    expect(updates).not.toHaveProperty("start_time");
    expect(updates).not.toHaveProperty("end_time");
  });

  it("skips fields that already match", () => {
    const appt = makeAppt({
      id: "a1",
      work_order_number: "WO-100",
      order_number: "ORD-100",
      customer_name: "Jane Smith",
      address: "456 Oak Ave, Toledo, OH 43604",
    });
    const rf = makeRF();

    const { fieldsUpdated } = buildMergeUpdates(appt, rf);

    expect(fieldsUpdated).not.toContain("work_order_number");
    expect(fieldsUpdated).not.toContain("order_number");
    expect(fieldsUpdated).not.toContain("customer_name");
    expect(fieldsUpdated).not.toContain("address");
  });

  it("appends rForce description to notes without duplicating", () => {
    const appt = makeAppt({ id: "a1", notes: "Manual note" });
    const rf = makeRF({ description: "Window replacement" });

    const { updates, fieldsUpdated } = buildMergeUpdates(appt, rf);

    expect(updates.notes).toBe("Manual note\n[rForce] Window replacement");
    expect(fieldsUpdated).toContain("notes");
  });

  it("does not duplicate existing rForce note", () => {
    const appt = makeAppt({
      id: "a1",
      notes: "Manual note\n[rForce] Window replacement",
    });
    const rf = makeRF({ description: "Window replacement" });

    const { fieldsUpdated } = buildMergeUpdates(appt, rf);

    // notes should NOT be in updates since it already contains the rForce note
    expect(fieldsUpdated).not.toContain("notes");
  });

  it("appends scheduler notes from rForce", () => {
    const appt = makeAppt({ id: "a1", notes: null });
    const rf = makeRF({
      description: null,
      scheduler_notes: "Call before arrival",
    });

    const { updates, fieldsUpdated } = buildMergeUpdates(appt, rf);

    expect(updates.notes).toBe("[rForce notes] Call before arrival");
    expect(fieldsUpdated).toContain("notes");
  });

  it("normalizes work_order_type to appointment_type", () => {
    const appt = makeAppt({ id: "a1", appointment_type: "tech_measure" });
    const rf = makeRF({ work_order_type: "Install" });

    const { updates, fieldsUpdated } = buildMergeUpdates(appt, rf);

    expect(updates.appointment_type).toBe("install");
    expect(fieldsUpdated).toContain("appointment_type");
  });

  it("sets merge_source_wo always", () => {
    const appt = makeAppt({ id: "a1" });
    const rf = makeRF();

    const { updates } = buildMergeUpdates(appt, rf);

    expect(updates.merge_source_wo).toBe("WO-100");
  });

  it("sets salesforce_url when WO number present", () => {
    const appt = makeAppt({ id: "a1" });
    const rf = makeRF();

    const { updates } = buildMergeUpdates(appt, rf);

    expect(updates.salesforce_url).toContain("WO-100");
  });

  it("handles null/missing rForce fields gracefully", () => {
    const appt = makeAppt({ id: "a1" });
    const rf = makeRF({
      customer_name: null,
      address: null,
      product_count: null,
      description: null,
      scheduler_notes: null,
    });

    const { fieldsUpdated } = buildMergeUpdates(appt, rf);

    // null rForce fields should not overwrite existing appointment data
    expect(fieldsUpdated).not.toContain("customer_name");
    expect(fieldsUpdated).not.toContain("address");
  });
});
