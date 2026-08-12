import { describe, it, expect } from "vitest";
import { findFuzzyMatches, buildFuzzyMatchIndex, findFuzzyMatchesIndexed } from "./fuzzy-match";
import { Appointment, RForceOrder, Crew, ResourceMapping } from "./types";

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
    customer_name: "John Doe",
    address: "123 Main St, Toledo, OH 43604",
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
    primary_resource: "John Smith",
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

function makeCrew(overrides: Partial<Crew> = {}): Crew {
  return {
    id: "crew-1",
    name: "John Smith",
    crew_type: "install_in_house",
    color: "#333",
    is_active: true,
    notes: null,
    aliases: null,
    manages: null,
    additional_types: null,
    primary_crew_id: null,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("findFuzzyMatches", () => {
  const crews = [makeCrew()];
  const mappings: ResourceMapping[] = [];
  const noLinks = new Set<string>();

  it("finds high-confidence match (same name + same date + same crew)", () => {
    const appts = [makeAppt({ id: "a1" })];
    const rf = makeRF();
    const matches = findFuzzyMatches(rf, appts, crews, mappings, noLinks);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe("high");
    expect(matches[0].score).toBeGreaterThanOrEqual(60);
  });

  it("skips cancelled appointments", () => {
    const appts = [makeAppt({ id: "a1", status: "cancelled" })];
    const rf = makeRF();
    expect(findFuzzyMatches(rf, appts, crews, mappings, noLinks)).toHaveLength(0);
  });

  it("skips unscheduled appointments", () => {
    const appts = [makeAppt({ id: "a1", status: "unscheduled" })];
    const rf = makeRF();
    expect(findFuzzyMatches(rf, appts, crews, mappings, noLinks)).toHaveLength(0);
  });

  it("skips appointments already linked to a different WO", () => {
    const appts = [makeAppt({ id: "a1", work_order_number: "WO-999" })];
    const rf = makeRF({ work_order_number: "WO-100" });
    expect(findFuzzyMatches(rf, appts, crews, mappings, noLinks)).toHaveLength(0);
  });

  it("skips appointments in activeLinkedAppointmentIds", () => {
    const appts = [makeAppt({ id: "a1" })];
    const rf = makeRF();
    const linked = new Set(["a1"]);
    expect(findFuzzyMatches(rf, appts, crews, mappings, linked)).toHaveLength(0);
  });

  it("skips rejected match pairs", () => {
    const appts = [makeAppt({ id: "a1" })];
    const rf = makeRF();
    const rejected = new Set(["a1|WO-100"]);
    expect(findFuzzyMatches(rf, appts, crews, mappings, noLinks, rejected)).toHaveLength(0);
  });

  it("returns no matches when names and dates differ", () => {
    const appts = [makeAppt({ id: "a1", customer_name: "Alice Wonderland", scheduled_date: "2026-09-01" })];
    const rf = makeRF({ customer_name: "Bob Builder", scheduled_start: "2026-08-10T08:00:00" });
    expect(findFuzzyMatches(rf, appts, crews, mappings, noLinks)).toHaveLength(0);
  });

  it("matches on same last name + same date", () => {
    const appts = [makeAppt({ id: "a1", customer_name: "Jane Doe" })];
    const rf = makeRF({ customer_name: "John Doe" });
    const matches = findFuzzyMatches(rf, appts, crews, mappings, noLinks);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchReasons).toContain("Same last name");
  });

  it("sorts by score descending", () => {
    const appts = [
      makeAppt({ id: "a1", customer_name: "Someone Else", scheduled_date: "2026-08-10" }),
      makeAppt({ id: "a2", customer_name: "John Doe", scheduled_date: "2026-08-10" }),
    ];
    const rf = makeRF({ customer_name: "John Doe" });
    const matches = findFuzzyMatches(rf, appts, crews, mappings, noLinks);
    if (matches.length >= 2) {
      expect(matches[0].score).toBeGreaterThanOrEqual(matches[1].score);
    }
  });
});

describe("buildFuzzyMatchIndex + findFuzzyMatchesIndexed", () => {
  it("produces same results as findFuzzyMatches", () => {
    const crews = [makeCrew()];
    const appts = [makeAppt({ id: "a1" })];
    const rf = makeRF();
    const noLinks = new Set<string>();
    const mappings: ResourceMapping[] = [];

    const direct = findFuzzyMatches(rf, appts, crews, mappings, noLinks);
    const index = buildFuzzyMatchIndex(appts, crews, noLinks);
    const indexed = findFuzzyMatchesIndexed(rf, index, mappings);

    expect(indexed).toHaveLength(direct.length);
    expect(indexed[0]?.score).toBe(direct[0]?.score);
    expect(indexed[0]?.appointment.id).toBe(direct[0]?.appointment.id);
  });
});
