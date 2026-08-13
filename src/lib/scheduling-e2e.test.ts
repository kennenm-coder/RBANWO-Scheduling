/**
 * End-to-end scheduling flow tests.
 *
 * These test the full scheduling lifecycle as pure logic — from
 * appointment creation through merge, conflict detection, validation,
 * flag detection, and sync transitions — without touching Supabase.
 */
import { describe, it, expect } from "vitest";
import { Appointment, Crew, RForceOrder, TimeOffRequest, AppointmentLink, AvailabilityRule, AvailabilityException } from "./types";
import { checkSchedulingConflicts, formatConflictMessage } from "./scheduling-validation";
import { validateAppointment } from "./scheduling-rules";
import { buildMergeUpdates } from "./merge";
import { captureOriginalEntry } from "./sync-transitions";
import { detectFlags, categorizeFlags, countActionableFlags } from "./flags";
import { formatProductBreakdown, formatProductShort, typeLabel } from "./calendar-utils";
import { normalizeWoType } from "./normalize";
import { getEligibleCrews, crewHasType } from "./crew-utils";

// ── Fixture builders ──

function makeAppt(overrides: Partial<Appointment> & { id: string }): Appointment {
  return {
    crew_id: "crew-install-1",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "install",
    order_number: "ORD-001",
    work_order_number: "WO-12345",
    customer_name: "Smith, John",
    address: "123 Main St, Toledo, OH 43604",
    scheduled_date: "2026-08-15",
    start_time: "08:00",
    end_time: "16:00",
    duration_days: 1,
    time_block: "full_day",
    status: "scheduled",
    notes: null,
    reschedule_reason: null,
    product_count: 5,
    salesforce_url: null,
    scheduled_by: "user-abc",
    merge_source_wo: null,
    origin: "manual",
    sync_state: "manual_awaiting_rforce",
    original_entry_snapshot: null,
    last_reconciled_import_id: null,
    version: 1,
    created_at: "2026-08-10T10:00:00Z",
    updated_at: "2026-08-10T10:00:00Z",
    ...overrides,
  };
}

function makeCrew(overrides: Partial<Crew> & { id: string }): Crew {
  return {
    name: "Team Alpha",
    crew_type: "install_in_house",
    color: "#2563eb",
    notes: null,
    sort_order: 1,
    is_active: true,
    aliases: null,
    manages: null,
    additional_types: null,
    primary_crew_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRForce(overrides: Partial<RForceOrder> = {}): RForceOrder {
  return {
    id: "rf-1",
    work_order_number: "WO-12345",
    order_number: "ORD-001",
    customer_name: "Smith, John",
    address: "123 Main St, Toledo, OH 43604",
    order_status: "In Progress",
    wo_status: "Scheduled",
    work_order_type: "Installation",
    booking_date: "2026-07-01",
    scheduled_start: "2026-08-15T08:00:00",
    scheduled_end: "2026-08-15T16:00:00",
    description: null,
    combined_retail_total: null,
    product_count: 5,
    total_units: 5,
    windows: 3,
    patio_doors: 1,
    doors: 1,
    order_owner: null,
    sales_rep: null,
    primary_resource: "Team Alpha",
    tech_measure_name: null,
    installer: null,
    service_rep: null,
    contact_name: null,
    email: null,
    phones: null,
    order_alerts: null,
    scheduler_notes: null,
    account_name: "Smith Residence",
    csv_import_id: "import-001",
    latitude: null,
    longitude: null,
    updated_at: "2026-08-10T08:00:00Z",
    ...overrides,
  };
}

function makeLink(overrides: Partial<AppointmentLink> = {}): AppointmentLink {
  return {
    id: "link-1",
    appointment_id: "appt-1",
    source_system: "rforce",
    external_key: "rf-1",
    work_order_number: "WO-12345",
    order_number: "ORD-001",
    match_method: "fuzzy",
    linked_by: null,
    linked_at: "2026-08-10T00:00:00Z",
    unlinked_by: null,
    unlinked_at: null,
    unlink_reason: null,
    created_at: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

// ── Tests ──

describe("E2E Scheduling Flow", () => {
  describe("1. Appointment creation and validation", () => {
    const crews: Crew[] = [
      makeCrew({ id: "crew-install-1", name: "Team Alpha", crew_type: "install_in_house" }),
      makeCrew({ id: "crew-measure-1", name: "Tech Bob", crew_type: "measure_tech" }),
      makeCrew({ id: "crew-jip-1", name: "JIP Team", crew_type: "jip" }),
    ];

    it("validates a well-formed appointment passes", () => {
      const result = validateAppointment(
        {
          appointment_type: "install",
          time_block: "full_day",
          product_count: 5,
          crew_id: "crew-install-1",
          scheduled_date: "2026-08-15",
        },
        [], // no existing
        crews[0],
        crews,
        []
      );
      expect(result).not.toBeNull();
      expect(result!.errors).toHaveLength(0);
    });

    it("warns when wrong crew type is assigned", () => {
      const result = validateAppointment(
        {
          appointment_type: "install",
          time_block: "full_day",
          product_count: 5,
          crew_id: "crew-measure-1",
          scheduled_date: "2026-08-15",
        },
        [],
        crews[1], // measure tech
        crews,
        []
      );
      expect(result).not.toBeNull();
      const allMessages = [...result!.errors, ...result!.warnings];
      expect(allMessages.length).toBeGreaterThan(0);
    });

    it("detects double-booking conflict", () => {
      const existing = [
        makeAppt({ id: "appt-1", time_block: "full_day", crew_id: "crew-install-1" }),
      ];
      const conflicts = checkSchedulingConflicts(
        "crew-install-1", "2026-08-15", 1, "full_day", null, existing
      );
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].reason).toBe("full_day_conflict");

      const msg = formatConflictMessage(conflicts[0]);
      expect(msg).toBeTruthy();
    });

    it("allows same date different crew", () => {
      const existing = [
        makeAppt({ id: "appt-1", time_block: "full_day", crew_id: "crew-install-1" }),
      ];
      const conflicts = checkSchedulingConflicts(
        "crew-measure-1", "2026-08-15", 1, "full_day", null, existing
      );
      expect(conflicts).toHaveLength(0);
    });

    it("detects multi-day conflict", () => {
      const existing = [
        makeAppt({ id: "appt-1", time_block: "full_day", crew_id: "crew-install-1", duration_days: 3, scheduled_date: "2026-08-14" }),
      ];
      const conflicts = checkSchedulingConflicts(
        "crew-install-1", "2026-08-15", 1, "full_day", null, existing
      );
      expect(conflicts).toHaveLength(1);
    });

    it("captures original entry snapshot", () => {
      const snapshot = captureOriginalEntry({
        customer_name: "Smith, John",
        address: "123 Main St, Toledo, OH 43604",
        scheduled_date: "2026-08-15",
        crew_id: "crew-install-1",
        time_block: "full_day",
        start_time: "08:00",
        notes: null,
        appointment_type: "install",
      });
      expect(snapshot).toBeTruthy();
      expect(snapshot!.customer_name).toBe("Smith, John");
      expect(snapshot!.captured_at).toBeTruthy();
    });
  });

  describe("2. Merge with rForce data", () => {
    it("rForce wins data fields, manual wins scheduling fields", () => {
      const appt = makeAppt({
        id: "appt-1",
        customer_name: "J. Smith",
        product_count: null,
        scheduled_date: "2026-08-15",
        crew_id: "crew-install-1",
      });
      const rforce = makeRForce({
        customer_name: "Smith, John",
        product_count: 5,
        scheduled_start: "2026-08-16T08:00:00", // different date — rForce loses
      });

      const { updates, fieldsUpdated } = buildMergeUpdates(appt, rforce);

      // rForce wins: customer_name, product_count
      expect(updates.customer_name).toBe("Smith, John");
      expect(updates.product_count).toBe(5);
      expect(fieldsUpdated).toContain("customer_name");
      expect(fieldsUpdated).toContain("product_count");

      // Manual wins: scheduled_date is NOT in updates
      expect(updates.scheduled_date).toBeUndefined();
    });

    it("normalizes work order type during merge", () => {
      const appt = makeAppt({ id: "appt-1", appointment_type: "install" });
      const rforce = makeRForce({ work_order_type: "JIP" });

      const { updates, fieldsUpdated } = buildMergeUpdates(appt, rforce);
      expect(updates.appointment_type).toBe("jip");
      expect(fieldsUpdated).toContain("appointment_type");
    });

    it("builds salesforce URL on merge", () => {
      const appt = makeAppt({ id: "appt-1", salesforce_url: null });
      const rforce = makeRForce({ work_order_number: "WO-99999" });

      const { updates } = buildMergeUpdates(appt, rforce);
      expect(updates.salesforce_url).toContain("WO-99999");
    });
  });

  describe("3. Product breakdown display", () => {
    it("shows W/PD/D breakdown when available", () => {
      const data = { product_count: 5, windows: 3, patio_doors: 1, doors: 1 };
      expect(formatProductBreakdown(data)).toBe("3W / 1PD / 1D");
    });

    it("shows compact format in parens", () => {
      const data = { product_count: 5, windows: 3, patio_doors: 1, doors: 1 };
      expect(formatProductShort(data)).toBe("(3W/1PD/1D)");
    });

    it("falls back to 'X units' when no breakdown", () => {
      const data = { product_count: 5, windows: 0, patio_doors: 0, doors: 0 };
      expect(formatProductBreakdown(data)).toBe("5 units");
    });

    it("returns null when no product data at all", () => {
      const data = { product_count: null, windows: null, patio_doors: null, doors: null };
      expect(formatProductBreakdown(data)).toBeNull();
    });

    it("handles windows only", () => {
      expect(formatProductBreakdown({ windows: 6, patio_doors: 0, doors: 0 })).toBe("6W");
    });

    it("handles patio doors only", () => {
      expect(formatProductBreakdown({ windows: 0, patio_doors: 2, doors: 0 })).toBe("2PD");
    });
  });

  describe("4. WO type normalization", () => {
    it("normalizes standard types", () => {
      expect(normalizeWoType("Install")).toBe("install");
      expect(normalizeWoType("Tech Measure")).toBe("tech_measure");
      expect(normalizeWoType("Service")).toBe("service");
    });

    it("normalizes JIP variants", () => {
      expect(normalizeWoType("JIP")).toBe("jip");
      expect(normalizeWoType("Job Site Visit")).toBe("jip");
    });

    it("normalizes paint/stain", () => {
      expect(normalizeWoType("Paint")).toBe("paint_stain");
      expect(normalizeWoType("Stain")).toBe("paint_stain");
    });

    it("returns null for unknown types", () => {
      expect(normalizeWoType("Foo Bar")).toBeNull();
      expect(normalizeWoType(null)).toBeNull();
    });
  });

  describe("5. Crew eligibility", () => {
    const crews: Crew[] = [
      makeCrew({ id: "c1", crew_type: "install_in_house" }),
      makeCrew({ id: "c2", crew_type: "measure_tech" }),
      makeCrew({ id: "c3", crew_type: "jip" }),
      makeCrew({ id: "c4", crew_type: "svc" }),
      makeCrew({ id: "c5", crew_type: "install_in_house", is_active: false }),
    ];

    it("returns install crews for install appointments", () => {
      const eligible = getEligibleCrews(crews, "install");
      expect(eligible.some((c) => c.id === "c1")).toBe(true);
      expect(eligible.some((c) => c.id === "c2")).toBe(false);
    });

    it("returns measure crews for tech_measure appointments", () => {
      const eligible = getEligibleCrews(crews, "tech_measure");
      expect(eligible.some((c) => c.id === "c2")).toBe(true);
      expect(eligible.some((c) => c.id === "c1")).toBe(false);
    });

    it("excludes inactive crews", () => {
      const eligible = getEligibleCrews(crews, "install");
      expect(eligible.some((c) => c.id === "c5")).toBe(false);
    });

    it("JIP crews are eligible for install appointments", () => {
      const eligible = getEligibleCrews(crews, "install");
      expect(eligible.some((c) => c.id === "c3")).toBe(true); // jip crew
    });

    it("SVC crews are eligible for service appointments", () => {
      const eligible = getEligibleCrews(crews, "service");
      expect(eligible.some((c) => c.id === "c4")).toBe(true); // svc crew
    });
  });

  describe("6. Flag detection (scheduling issues)", () => {
    const crews: Crew[] = [
      makeCrew({ id: "crew-install-1", crew_type: "install_in_house" }),
      makeCrew({ id: "crew-measure-1", crew_type: "measure_tech" }),
    ];
    const emptyTimeOff: TimeOffRequest[] = [];
    const emptyRules: AvailabilityRule[] = [];
    const emptyExceptions: AvailabilityException[] = [];

    it("flags appointment with missing crew", () => {
      const appts = [
        makeAppt({ id: "a1", crew_id: null }),
      ];
      const flags = detectFlags(appts, crews, [], emptyTimeOff, [], emptyRules, emptyExceptions);
      const crewFlags = flags.filter((f) => f.code === "missing_crew");
      expect(crewFlags.length).toBeGreaterThan(0);
    });

    it("flags double booking", () => {
      const appts = [
        makeAppt({ id: "a1", crew_id: "crew-install-1", scheduled_date: "2026-08-15", time_block: "full_day" }),
        makeAppt({ id: "a2", crew_id: "crew-install-1", scheduled_date: "2026-08-15", time_block: "full_day", customer_name: "Jones" }),
      ];
      const flags = detectFlags(appts, crews, [], emptyTimeOff, [], emptyRules, emptyExceptions);
      const doubleFlags = flags.filter((f) => f.code === "double_booking");
      expect(doubleFlags.length).toBeGreaterThan(0);
    });

    it("flags wrong resource type", () => {
      const appts = [
        makeAppt({
          id: "a1",
          crew_id: "crew-measure-1",
          appointment_type: "install",
        }),
      ];
      const flags = detectFlags(appts, crews, [], emptyTimeOff, [], emptyRules, emptyExceptions);
      const typeFlags = flags.filter((f) => f.code === "invalid_resource_type");
      expect(typeFlags.length).toBeGreaterThan(0);
    });

    it("categorizes flags correctly", () => {
      const appts = [
        makeAppt({ id: "a1", crew_id: null }),
      ];
      const flags = detectFlags(appts, crews, [], emptyTimeOff, [], emptyRules, emptyExceptions);
      const { actionRequired } = categorizeFlags(flags);
      expect(actionRequired.length).toBeGreaterThan(0);
    });

    it("counts actionable flags", () => {
      const appts = [
        makeAppt({ id: "a1", crew_id: null }),
        makeAppt({ id: "a2", address: "" }),
      ];
      const flags = detectFlags(appts, crews, [], emptyTimeOff, [], emptyRules, emptyExceptions);
      const count = countActionableFlags(flags);
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  describe("7. Display helpers", () => {
    it("typeLabel returns human-readable labels", () => {
      expect(typeLabel("install")).toBe("Install");
      expect(typeLabel("tech_measure")).toBe("Tech Measure");
      expect(typeLabel("jip")).toBe("JIP");
      expect(typeLabel("service")).toBe("Service");
      expect(typeLabel("paint_stain")).toBe("Paint/Stain");
    });
  });

  describe("8. Full lifecycle simulation", () => {
    it("create → conflict check → merge → flag check", () => {
      const crews: Crew[] = [
        makeCrew({ id: "crew-1", crew_type: "install_in_house" }),
      ];

      // Step 1: Create appointment
      const appt = makeAppt({
        id: "appt-new",
        crew_id: "crew-1",
        customer_name: "Anderson, Mike",
        address: "456 Oak Ave, Findlay, OH 45840",
        scheduled_date: "2026-08-20",
        time_block: "full_day",
        product_count: null,
        work_order_number: null,
        scheduled_by: "user-123",
      });

      // Step 2: Verify no conflicts
      const conflicts = checkSchedulingConflicts(
        "crew-1", "2026-08-20", 1, "full_day", null, []
      );
      expect(conflicts).toHaveLength(0);

      // Step 3: rForce data arrives — merge
      const rforce = makeRForce({
        work_order_number: "WO-99999",
        customer_name: "Anderson, Michael",
        product_count: 8,
        windows: 6,
        patio_doors: 1,
        doors: 1,
      });
      const { updates, fieldsUpdated } = buildMergeUpdates(appt, rforce);
      expect(updates.customer_name).toBe("Anderson, Michael");
      expect(updates.product_count).toBe(8);
      expect(fieldsUpdated.length).toBeGreaterThan(0);

      // Step 4: Apply merge to get updated appointment
      const merged: Appointment = {
        ...appt,
        ...updates,
        work_order_number: "WO-99999",
        merge_source_wo: "WO-99999",
      };
      expect(merged.customer_name).toBe("Anderson, Michael");
      expect(merged.product_count).toBe(8);

      // Step 5: Verify product breakdown display
      expect(formatProductBreakdown(rforce)).toBe("6W / 1PD / 1D");

      // Step 6: Check flags — linked appointment should have no live_app errors
      const link = makeLink({
        appointment_id: "appt-new",
        work_order_number: "WO-99999",
      });
      const flags = detectFlags(
        [merged], crews, [rforce], [], [link], [], []
      );
      const liveErrors = flags.filter(
        (f) => f.flagClass === "live_app" && f.severity === "error"
      );
      expect(liveErrors).toHaveLength(0);
    });
  });
});
