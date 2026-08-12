import { describe, it, expect } from "vitest";
import { getRForceResource } from "./normalize";
import type { RForceOrder } from "./types";

/**
 * Tests for resource-learning logic.
 * The actual learnResourceMapping function calls Supabase, so we test
 * the pure logic: which resource name gets extracted from an rForce order.
 */

function makeRF(overrides: Partial<RForceOrder> = {}): RForceOrder {
  return {
    id: "rf-1",
    order_number: "ORD-100",
    work_order_number: "WO-100",
    order_status: "Scheduled",
    wo_status: "Open",
    work_order_type: "Install",
    customer_name: "John Doe",
    address: "123 Main St",
    booking_date: null,
    scheduled_start: "2026-08-10T08:00:00",
    scheduled_end: "2026-08-10T16:00:00",
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
    updated_at: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

describe("getRForceResource (resource name extraction)", () => {
  it("picks primary_resource first", () => {
    const rf = makeRF({
      primary_resource: "Alpha Crew",
      tech_measure_name: "Beta Tech",
      installer: "Gamma Install",
    });
    expect(getRForceResource(rf)).toBe("Alpha Crew");
  });

  it("falls back to tech_measure_name", () => {
    const rf = makeRF({
      primary_resource: null,
      tech_measure_name: "Beta Tech",
    });
    expect(getRForceResource(rf)).toBe("Beta Tech");
  });

  it("falls back to installer", () => {
    const rf = makeRF({
      primary_resource: null,
      tech_measure_name: null,
      installer: "Gamma Install",
    });
    expect(getRForceResource(rf)).toBe("Gamma Install");
  });

  it("falls back to service_rep", () => {
    const rf = makeRF({
      primary_resource: null,
      tech_measure_name: null,
      installer: null,
      service_rep: "Delta Service",
    });
    expect(getRForceResource(rf)).toBe("Delta Service");
  });

  it("returns null when no resource fields set", () => {
    const rf = makeRF({
      primary_resource: null,
      tech_measure_name: null,
      installer: null,
      service_rep: null,
    });
    expect(getRForceResource(rf)).toBeNull();
  });
});
