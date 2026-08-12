import { describe, it, expect } from "vitest";
import {
  detectFlags,
  applyResolutions,
  categorizeFlags,
  countActionableFlags,
} from "./flags";
import type {
  Appointment,
  AvailabilityRule,
  Crew,
  RForceOrder,
  AppointmentLink,
  SchedulingFlag,
} from "./types";

// ── Factories ──

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    crew_id: "crew-1",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "install",
    order_number: "ORD-100",
    work_order_number: "WO-100",
    customer_name: "Test Customer",
    address: "123 Main St, Toledo, OH 43615",
    scheduled_date: "2026-08-06",
    start_time: "09:00:00",
    end_time: "11:00:00",
    duration_days: 1,
    time_block: "9-10",
    status: "scheduled",
    notes: null,
    reschedule_reason: null,
    product_count: 5,
    salesforce_url: null,
    scheduled_by: null,
    merge_source_wo: null,
    origin: "manual",
    sync_state: "manual_awaiting_rforce",
    original_entry_snapshot: null,
    last_reconciled_import_id: null,
    version: 1,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeCrew(overrides: Partial<Crew> = {}): Crew {
  return {
    id: "crew-1",
    name: "John Smith",
    crew_type: "install_in_house",
    color: "#3B7A33",
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

function makeRForceOrder(overrides: Partial<RForceOrder> = {}): RForceOrder {
  return {
    id: "rf-1",
    order_number: "ORD-100",
    work_order_number: "WO-100",
    order_status: "Scheduled",
    wo_status: "Open",
    work_order_type: "Install",
    customer_name: "Test Customer",
    address: "123 Main St, Toledo, OH 43615",
    booking_date: "2026-07-01",
    scheduled_start: "2026-08-06T09:00:00",
    scheduled_end: "2026-08-06T11:00:00",
    description: null,
    combined_retail_total: null,
    product_count: 5,
    total_units: 5,
    windows: 4,
    patio_doors: 1,
    doors: 0,
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
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeLink(overrides: Partial<AppointmentLink> = {}): AppointmentLink {
  return {
    id: "link-1",
    appointment_id: "appt-1",
    source_system: "rforce",
    external_key: "rf-1",
    work_order_number: "WO-100",
    order_number: "ORD-100",
    match_method: "wo_exact",
    linked_by: null,
    linked_at: "2026-08-01T00:00:00Z",
    unlinked_by: null,
    unlinked_at: null,
    unlink_reason: null,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

// ── Tests ──

describe("detectFlags", () => {
  describe("Class 1: Live app issues", () => {
    it("flags missing crew", () => {
      const appt = makeAppointment({ crew_id: null });
      const flags = detectFlags([appt], [makeCrew()], [], [], []);
      const missing = flags.filter((f) => f.code === "missing_crew");
      expect(missing).toHaveLength(1);
      expect(missing[0].flagClass).toBe("live_app");
      expect(missing[0].severity).toBe("error");
      expect(missing[0].autoClears).toBe(true);
    });

    it("flags missing scheduled date", () => {
      const appt = makeAppointment({ scheduled_date: null });
      const flags = detectFlags([appt], [makeCrew()], [], [], []);
      const missing = flags.filter((f) => f.code === "missing_scheduled_date");
      expect(missing).toHaveLength(1);
      expect(missing[0].flagClass).toBe("live_app");
    });

    it("flags missing address", () => {
      const appt = makeAppointment({ address: "" });
      const flags = detectFlags([appt], [makeCrew()], [], [], []);
      const missing = flags.filter((f) => f.code === "missing_address");
      expect(missing).toHaveLength(1);
      expect(missing[0].severity).toBe("warning");
    });

    it("flags double booking", () => {
      const appt1 = makeAppointment({ id: "appt-1", time_block: "9-10" });
      const appt2 = makeAppointment({ id: "appt-2", time_block: "9-10" });
      const flags = detectFlags([appt1, appt2], [makeCrew()], [], [], []);
      const doubles = flags.filter((f) => f.code === "double_booking");
      expect(doubles).toHaveLength(1);
      expect(doubles[0].severity).toBe("error");
    });

    it("does not flag double booking across different crews", () => {
      const appt1 = makeAppointment({ id: "appt-1", crew_id: "crew-1" });
      const appt2 = makeAppointment({ id: "appt-2", crew_id: "crew-2" });
      const flags = detectFlags([appt1, appt2], [makeCrew()], [], [], []);
      const doubles = flags.filter((f) => f.code === "double_booking");
      expect(doubles).toHaveLength(0);
    });

    it("does not flag cancelled appointments", () => {
      const appt = makeAppointment({ crew_id: null, status: "cancelled" });
      const flags = detectFlags([appt], [makeCrew()], [], [], []);
      expect(flags.filter((f) => f.code === "missing_crew")).toHaveLength(0);
    });

    it("does not flag unscheduled appointments", () => {
      const appt = makeAppointment({ crew_id: null, status: "unscheduled" });
      const flags = detectFlags([appt], [makeCrew()], [], [], []);
      expect(flags.filter((f) => f.code === "missing_crew")).toHaveLength(0);
    });

    it("flags invalid resource type (measure tech on install)", () => {
      const appt = makeAppointment({ appointment_type: "install" });
      const crew = makeCrew({ crew_type: "measure_tech" });
      const flags = detectFlags([appt], [crew], [], [], []);
      const invalid = flags.filter((f) => f.code === "invalid_resource_type");
      expect(invalid).toHaveLength(1);
      expect(invalid[0].severity).toBe("warning");
    });

    it("does not flag valid resource type", () => {
      const appt = makeAppointment({ appointment_type: "install" });
      const crew = makeCrew({ crew_type: "install_in_house" });
      const flags = detectFlags([appt], [crew], [], [], []);
      expect(flags.filter((f) => f.code === "invalid_resource_type")).toHaveLength(0);
    });

    it("respects additional_types for eligibility", () => {
      const appt = makeAppointment({ appointment_type: "tech_measure" });
      const crew = makeCrew({ crew_type: "install_in_house", additional_types: ["measure_tech"] });
      const flags = detectFlags([appt], [crew], [], [], []);
      expect(flags.filter((f) => f.code === "invalid_resource_type")).toHaveLength(0);
    });

    it("management crews are eligible for any appointment type", () => {
      const types = ["install", "service", "tech_measure", "jip"] as const;
      for (const apptType of types) {
        const appt = makeAppointment({ appointment_type: apptType });
        const crew = makeCrew({ crew_type: "management" });
        const flags = detectFlags([appt], [crew], [], [], []);
        expect(flags.filter((f) => f.code === "invalid_resource_type")).toHaveLength(0);
      }
    });

    it("jip crews can handle service appointments", () => {
      const appt = makeAppointment({ appointment_type: "service" });
      const crew = makeCrew({ crew_type: "jip" });
      const flags = detectFlags([appt], [crew], [], [], []);
      expect(flags.filter((f) => f.code === "invalid_resource_type")).toHaveLength(0);
    });

    it("svc crews can handle install appointments", () => {
      const appt = makeAppointment({ appointment_type: "install" });
      const crew = makeCrew({ crew_type: "svc" });
      const flags = detectFlags([appt], [crew], [], [], []);
      expect(flags.filter((f) => f.code === "invalid_resource_type")).toHaveLength(0);
    });

    it("flags missing time block", () => {
      const appt = makeAppointment({ time_block: null });
      const flags = detectFlags([appt], [makeCrew()], [], [], []);
      const missing = flags.filter((f) => f.code === "missing_time");
      expect(missing).toHaveLength(1);
      expect(missing[0].severity).toBe("warning");
    });

    it("flags multi-day double booking", () => {
      const appt1 = makeAppointment({
        id: "appt-1", time_block: "full_day",
        scheduled_date: "2026-08-06", duration_days: 3,
      });
      const appt2 = makeAppointment({
        id: "appt-2", time_block: "full_day",
        scheduled_date: "2026-08-08", duration_days: 1,
      });
      const flags = detectFlags([appt1, appt2], [makeCrew()], [], [], []);
      const doubles = flags.filter((f) => f.code === "double_booking");
      expect(doubles).toHaveLength(1);
      expect(doubles[0].message).toContain("multi-day overlap");
    });

    it("flags duplicate work order number", () => {
      const appt1 = makeAppointment({ id: "appt-1", work_order_number: "WO-100" });
      const appt2 = makeAppointment({ id: "appt-2", work_order_number: "WO-100", time_block: "10-12" });
      const flags = detectFlags([appt1, appt2], [makeCrew()], [], [], []);
      const dupes = flags.filter((f) => f.code === "duplicate_app_appointment");
      expect(dupes).toHaveLength(1);
    });

    it("flags availability conflict (full day PTO)", () => {
      const appt = makeAppointment({ scheduled_date: "2026-08-06" });
      const crew = makeCrew();
      const rule: AvailabilityRule = {
        id: "rule-1",
        crew_id: "crew-1",
        kind: "pto",
        department: null,
        start_time: null,
        end_time: null,
        weekdays: [],
        repeat_interval: 1,
        effective_start: "2026-08-06",
        effective_end: "2026-08-06",
        reason: "Vacation",
        is_active: true,
        created_by: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      const flags = detectFlags([appt], [crew], [], [], [], [rule], []);
      const conflicts = flags.filter((f) => f.code === "availability_conflict");
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].severity).toBe("error");
      expect(conflicts[0].message).toContain("Vacation");
    });
  });

  describe("Class 2: External confirmation issues", () => {
    it("flags date mismatch", () => {
      const appt = makeAppointment({ scheduled_date: "2026-08-10" });
      const rf = makeRForceOrder({ scheduled_start: "2026-08-06T09:00:00" });
      const flags = detectFlags([appt], [makeCrew()], [rf], [], []);
      const mismatches = flags.filter((f) => f.code === "date_mismatch");
      expect(mismatches).toHaveLength(1);
      expect(mismatches[0].flagClass).toBe("external_confirmation");
      expect(mismatches[0].canAcknowledge).toBe(true);
      expect(mismatches[0].autoClears).toBe(false);
    });

    it("flags time mismatch", () => {
      const appt = makeAppointment({ start_time: "16:00:00", time_block: "4-6" });
      const rf = makeRForceOrder({ scheduled_start: "2026-08-06T14:00:00" });
      const flags = detectFlags([appt], [makeCrew()], [rf], [], []);
      const mismatches = flags.filter((f) => f.code === "time_mismatch");
      expect(mismatches).toHaveLength(1);
    });

    it("flags resource mismatch", () => {
      const appt = makeAppointment();
      const crew = makeCrew({ name: "John Smith" });
      const rf = makeRForceOrder({ primary_resource: "Mike Jones" });
      const flags = detectFlags([appt], [crew], [rf], [], []);
      const mismatches = flags.filter((f) => f.code === "resource_mismatch");
      expect(mismatches).toHaveLength(1);
    });

    it("does not flag when values match", () => {
      const appt = makeAppointment({
        scheduled_date: "2026-08-06",
        start_time: "09:00:00",
        time_block: "9-10",
        appointment_type: "install",
      });
      const crew = makeCrew({ name: "John Smith" });
      const rf = makeRForceOrder({
        scheduled_start: "2026-08-06T09:00:00",
        primary_resource: "John Smith",
        work_order_type: "Install",
      });
      const flags = detectFlags([appt], [crew], [rf], [], []);
      const external = flags.filter((f) => f.flagClass === "external_confirmation");
      expect(external).toHaveLength(0);
    });

    it("emits per-field flags (not one per WO)", () => {
      const appt = makeAppointment({ scheduled_date: "2026-08-10", start_time: "16:00:00", time_block: "4-6" });
      const crew = makeCrew({ name: "John Smith" });
      const rf = makeRForceOrder({
        scheduled_start: "2026-08-06T09:00:00",
        primary_resource: "Mike Jones",
      });
      const flags = detectFlags([appt], [crew], [rf], [], []);
      const external = flags.filter((f) => f.flagClass === "external_confirmation");
      // date, time, and resource should each be separate flags
      expect(external.length).toBeGreaterThanOrEqual(3);
      const codes = external.map((f) => f.code);
      expect(codes).toContain("date_mismatch");
      expect(codes).toContain("time_mismatch");
      expect(codes).toContain("resource_mismatch");
    });
  });

  describe("Class 3: Workflow issues", () => {
    it("flags unlinked appointment", () => {
      const appt = makeAppointment();
      const flags = detectFlags([appt], [makeCrew()], [], [], []);
      const unlinked = flags.filter((f) => f.code === "unlinked_appointment");
      expect(unlinked).toHaveLength(1);
      expect(unlinked[0].flagClass).toBe("workflow");
      expect(unlinked[0].severity).toBe("info");
    });

    it("does not flag linked appointment", () => {
      const appt = makeAppointment();
      const link = makeLink();
      const flags = detectFlags([appt], [makeCrew()], [], [], [link]);
      const unlinked = flags.filter((f) => f.code === "unlinked_appointment");
      expect(unlinked).toHaveLength(0);
    });

    it("flags duplicate links", () => {
      const appt = makeAppointment();
      const link1 = makeLink({ id: "link-1" });
      const link2 = makeLink({ id: "link-2", external_key: "rf-2" });
      const flags = detectFlags([appt], [makeCrew()], [], [], [link1, link2]);
      const dupes = flags.filter((f) => f.code === "duplicate_link");
      expect(dupes).toHaveLength(1);
    });
  });

  describe("Sorting", () => {
    it("sorts errors before warnings before info", () => {
      const appt = makeAppointment({ crew_id: null, address: "" });
      const flags = detectFlags([appt], [makeCrew()], [], [], []);
      const severities = flags.map((f) => f.severity);
      const errorIdx = severities.indexOf("error");
      const warnIdx = severities.indexOf("warning");
      const infoIdx = severities.indexOf("info");
      if (errorIdx !== -1 && warnIdx !== -1) {
        expect(errorIdx).toBeLessThan(warnIdx);
      }
      if (warnIdx !== -1 && infoIdx !== -1) {
        expect(warnIdx).toBeLessThan(infoIdx);
      }
    });
  });
});

describe("applyResolutions", () => {
  it("marks resolved external flags as waiting_for_import", () => {
    const flag: SchedulingFlag = {
      id: "test-flag",
      fingerprint: { flagCode: "date_mismatch" },
      flagClass: "external_confirmation",
      state: "open",
      code: "date_mismatch",
      severity: "warning",
      message: "date differs",
      resolution: "update rForce",
      autoClears: false,
      canAcknowledge: true,
    };
    const result = applyResolutions([flag], new Set(["test-flag"]));
    expect(result[0].state).toBe("waiting_for_import");
  });

  it("does not change state of live_app flags even if resolved", () => {
    const flag: SchedulingFlag = {
      id: "live-flag",
      fingerprint: { flagCode: "missing_crew" },
      flagClass: "live_app",
      state: "open",
      code: "missing_crew",
      severity: "error",
      message: "no crew",
      resolution: "assign crew",
      autoClears: true,
      canAcknowledge: false,
    };
    const result = applyResolutions([flag], new Set(["live-flag"]));
    expect(result[0].state).toBe("open");
  });
});

describe("categorizeFlags", () => {
  it("puts live_app flags in actionRequired", () => {
    const flag: SchedulingFlag = {
      id: "f1",
      fingerprint: { flagCode: "missing_crew" },
      flagClass: "live_app",
      state: "open",
      code: "missing_crew",
      severity: "error",
      message: "",
      resolution: "",
      autoClears: true,
      canAcknowledge: false,
    };
    const result = categorizeFlags([flag]);
    expect(result.actionRequired).toHaveLength(1);
    expect(result.updateRForce).toHaveLength(0);
  });

  it("puts external_confirmation flags in updateRForce", () => {
    const flag: SchedulingFlag = {
      id: "f2",
      fingerprint: { flagCode: "date_mismatch" },
      flagClass: "external_confirmation",
      state: "open",
      code: "date_mismatch",
      severity: "warning",
      message: "",
      resolution: "",
      autoClears: false,
      canAcknowledge: true,
    };
    const result = categorizeFlags([flag]);
    expect(result.updateRForce).toHaveLength(1);
    expect(result.actionRequired).toHaveLength(0);
  });

  it("puts waiting_for_import flags in their section", () => {
    const flag: SchedulingFlag = {
      id: "f3",
      fingerprint: { flagCode: "date_mismatch" },
      flagClass: "external_confirmation",
      state: "waiting_for_import",
      code: "date_mismatch",
      severity: "warning",
      message: "",
      resolution: "",
      autoClears: false,
      canAcknowledge: true,
    };
    const result = categorizeFlags([flag]);
    expect(result.waitingForImport).toHaveLength(1);
    expect(result.updateRForce).toHaveLength(0);
  });
});

describe("countActionableFlags", () => {
  it("counts open non-info flags", () => {
    const flags: SchedulingFlag[] = [
      {
        id: "1", fingerprint: { flagCode: "missing_crew" },
        flagClass: "live_app", state: "open", code: "missing_crew",
        severity: "error", message: "", resolution: "", autoClears: true, canAcknowledge: false,
      },
      {
        id: "2", fingerprint: { flagCode: "date_mismatch" },
        flagClass: "external_confirmation", state: "open", code: "date_mismatch",
        severity: "warning", message: "", resolution: "", autoClears: false, canAcknowledge: true,
      },
      {
        id: "3", fingerprint: { flagCode: "unlinked_appointment" },
        flagClass: "workflow", state: "open", code: "unlinked_appointment",
        severity: "info", message: "", resolution: "", autoClears: false, canAcknowledge: false,
      },
      {
        id: "4", fingerprint: { flagCode: "date_mismatch" },
        flagClass: "external_confirmation", state: "waiting_for_import", code: "date_mismatch",
        severity: "warning", message: "", resolution: "", autoClears: false, canAcknowledge: true,
      },
    ];
    // Only #1 (error, open) and #2 (warning, open) count
    // #3 is info (excluded), #4 is waiting_for_import (excluded)
    expect(countActionableFlags(flags)).toBe(2);
  });
});
