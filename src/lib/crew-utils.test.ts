import { describe, it, expect } from "vitest";
import {
  crewHasType,
  isDualRole,
  parseCity,
  getEligibleCrews,
  getBlockedTimeBlocks,
  getAvailableTimeBlocks,
  getDepartmentSections,
  getCrewRoleBlock,
  isForeignToSection,
} from "./crew-utils";
import { Crew, Appointment, AvailabilityRule } from "./types";

function makeRule(overrides: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return {
    id: "rule-1",
    crew_id: "josh",
    kind: "role_assignment",
    department: "service",
    start_time: null,
    end_time: null,
    weekdays: [1, 2, 3],
    repeat_interval: 1,
    effective_start: "2020-01-01",
    effective_end: null,
    reason: null,
    is_active: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// Josh: a service tech who also takes measures and JIPs.
function dualRoleCrew(): Crew {
  return makeCrew({
    id: "josh",
    name: "Josh McIntyre",
    crew_type: "svc",
    additional_types: ["measure_tech", "jip"],
  });
}

const MONDAY = new Date(2026, 9, 5); // 2026-10-05
const THURSDAY = new Date(2026, 9, 8); // 2026-10-08

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

function makeAppt(overrides: Partial<Appointment> & { id: string }): Appointment {
  return {
    crew_id: "crew-1",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "install",
    order_number: null,
    work_order_number: null,
    customer_name: "Test",
    address: "123 Main St",
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

describe("crewHasType", () => {
  it("matches primary crew type", () => {
    const crew = makeCrew({ crew_type: "measure_tech" });
    expect(crewHasType(crew, "measure_tech")).toBe(true);
  });

  it("matches additional types", () => {
    const crew = makeCrew({ crew_type: "install_in_house", additional_types: ["measure_tech"] });
    expect(crewHasType(crew, "measure_tech")).toBe(true);
  });

  it("returns false when no match", () => {
    const crew = makeCrew({ crew_type: "install_in_house" });
    expect(crewHasType(crew, "svc")).toBe(false);
  });
});

describe("isDualRole", () => {
  it("returns false for single-type crew", () => {
    const crew = makeCrew({ crew_type: "install_in_house" });
    expect(isDualRole(crew)).toBe(false);
  });

  it("returns true for crew with multiple main types", () => {
    const crew = makeCrew({ crew_type: "install_in_house", additional_types: ["svc"] });
    expect(isDualRole(crew)).toBe(true);
  });

  it("returns false when additional type is second/management", () => {
    const crew = makeCrew({ crew_type: "install_in_house", additional_types: ["second"] });
    expect(isDualRole(crew)).toBe(false);
  });
});

describe("parseCity", () => {
  it("extracts city from standard address", () => {
    expect(parseCity("123 Main St, Toledo, OH 43604")).toBe("Toledo");
  });

  it("extracts city from short address", () => {
    expect(parseCity("Toledo, OH 43604")).toBe("Toledo");
  });

  it("returns empty string for empty input", () => {
    expect(parseCity("")).toBe("");
  });
});

describe("getEligibleCrews", () => {
  it("returns measure techs for tech_measure", () => {
    const crews = [
      makeCrew({ id: "c1", crew_type: "measure_tech" }),
      makeCrew({ id: "c2", crew_type: "install_in_house" }),
    ];
    const eligible = getEligibleCrews(crews, "tech_measure");
    expect(eligible.map((c) => c.id)).toEqual(["c1"]);
  });

  it("includes JIP crews for install", () => {
    const crews = [
      makeCrew({ id: "c1", crew_type: "jip" }),
      makeCrew({ id: "c2", crew_type: "svc" }),
    ];
    const eligible = getEligibleCrews(crews, "install");
    expect(eligible.map((c) => c.id)).toEqual(["c1"]);
  });

  it("excludes inactive crews", () => {
    const crews = [
      makeCrew({ id: "c1", crew_type: "measure_tech", is_active: false }),
    ];
    expect(getEligibleCrews(crews, "tech_measure")).toHaveLength(0);
  });

  it("treats every active crew as eligible for a job site visit", () => {
    const crews = [
      makeCrew({ id: "c1", crew_type: "measure_tech" }),
      makeCrew({ id: "c2", crew_type: "install_in_house" }),
      makeCrew({ id: "c3", crew_type: "svc" }),
      makeCrew({ id: "c4", crew_type: "management" }),
      makeCrew({ id: "c5", crew_type: "measure_tech", is_active: false }),
    ];
    const ids = getEligibleCrews(crews, "job_site_visit").map((c) => c.id);
    expect(ids).toEqual(["c1", "c2", "c3", "c4"]); // all active, no restriction
  });

  it("treats management crews as eligible for every appointment type", () => {
    // Managers cover any role — this must match the flag engine so a measure
    // scheduled on a manager doesn't fail validation when it's later edited.
    const crews = [
      makeCrew({ id: "mgr", crew_type: "management", manages: ["measure"] }),
      makeCrew({ id: "mgr2", crew_type: "management", manages: null }),
    ];
    for (const type of ["tech_measure", "install", "service", "jip", "lswp"] as const) {
      const ids = getEligibleCrews(crews, type).map((c) => c.id);
      expect(ids).toContain("mgr");
      expect(ids).toContain("mgr2");
    }
  });
});

describe("getBlockedTimeBlocks", () => {
  it("blocks the time_block of an existing appointment", () => {
    const appts = [
      makeAppt({ id: "a1", time_block: "9-10", appointment_type: "tech_measure" }),
    ];
    const blocked = getBlockedTimeBlocks("crew-1", appts, "2026-08-10");
    expect(blocked.has("9-10")).toBe(true);
    expect(blocked.has("10-12")).toBe(false);
  });

  it("blocks all measure blocks for full_day", () => {
    const appts = [
      makeAppt({ id: "a1", time_block: "full_day" }),
    ];
    const blocked = getBlockedTimeBlocks("crew-1", appts, "2026-08-10");
    expect(blocked.has("full_day")).toBe(true);
    expect(blocked.has("9-10")).toBe(true);
    expect(blocked.has("4-6")).toBe(true);
  });

  it("handles multi-block spans", () => {
    const appts = [
      makeAppt({ id: "a1", time_block: "10-12", time_block_end: "2-4", appointment_type: "tech_measure" }),
    ];
    const blocked = getBlockedTimeBlocks("crew-1", appts, "2026-08-10");
    expect(blocked.has("10-12")).toBe(true);
    expect(blocked.has("12-2")).toBe(true);
    expect(blocked.has("2-4")).toBe(true);
    expect(blocked.has("9-10")).toBe(false);
    expect(blocked.has("4-6")).toBe(false);
  });

  it("handles multi-day appointments", () => {
    const appts = [
      makeAppt({ id: "a1", scheduled_date: "2026-08-09", duration_days: 3, time_block: "full_day" }),
    ];
    // Aug 10 is day 2 of a 3-day appointment
    const blocked = getBlockedTimeBlocks("crew-1", appts, "2026-08-10");
    expect(blocked.has("full_day")).toBe(true);
    expect(blocked.has("9-10")).toBe(true);
  });

  it("ignores cancelled appointments", () => {
    const appts = [
      makeAppt({ id: "a1", time_block: "9-10", status: "cancelled" }),
    ];
    const blocked = getBlockedTimeBlocks("crew-1", appts, "2026-08-10");
    expect(blocked.size).toBe(0);
  });

  it("checks secondary and tertiary crew", () => {
    const appts = [
      makeAppt({ id: "a1", crew_id: "crew-2", secondary_crew_id: "crew-1", time_block: "9-10", appointment_type: "tech_measure" }),
    ];
    const blocked = getBlockedTimeBlocks("crew-1", appts, "2026-08-10");
    expect(blocked.has("9-10")).toBe(true);
  });
});

describe("getAvailableTimeBlocks", () => {
  it("returns blocks not in the blocked set", () => {
    const appts = [
      makeAppt({ id: "a1", time_block: "9-10", appointment_type: "tech_measure" }),
      makeAppt({ id: "a2", time_block: "10-12", appointment_type: "tech_measure" }),
    ];
    const available = getAvailableTimeBlocks("crew-1", appts, "2026-08-10");
    expect(available).toContain("12-2");
    expect(available).toContain("2-4");
    expect(available).toContain("4-6");
    expect(available).not.toContain("9-10");
    expect(available).not.toContain("10-12");
  });
});

describe("getDepartmentSections — multi-department resources", () => {
  it("gives a tri-role resource a row in every section they cover", () => {
    const sections = getDepartmentSections([dualRoleCrew()]);
    const keysWithJosh = sections
      .filter((s) => s.crews.some((c) => c.id === "josh"))
      .map((s) => s.key);
    expect(keysWithJosh.sort()).toEqual(["jip", "measure", "service"]);
  });

  it("leaves a single-type resource in exactly one section", () => {
    const sections = getDepartmentSections([makeCrew({ id: "solo", crew_type: "svc" })]);
    const keysWithSolo = sections
      .filter((s) => s.crews.some((c) => c.id === "solo"))
      .map((s) => s.key);
    expect(keysWithSolo).toEqual(["service"]);
  });
});

describe("getCrewRoleBlock", () => {
  const rules = [
    makeRule({ id: "r-svc", department: "service", weekdays: [1, 2, 3] }),
    makeRule({ id: "r-mt", department: "measure", weekdays: [4, 5] }),
  ];

  it("blocks the measure row on a service day", () => {
    const block = getCrewRoleBlock(dualRoleCrew(), "measure", MONDAY, rules, []);
    expect(block).toEqual({ department: "service", label: "Service" });
  });

  it("leaves the service row live on a service day", () => {
    expect(getCrewRoleBlock(dualRoleCrew(), "service", MONDAY, rules, [])).toBeNull();
  });

  it("flips on a measure day", () => {
    expect(getCrewRoleBlock(dualRoleCrew(), "measure", THURSDAY, rules, [])).toBeNull();
    expect(getCrewRoleBlock(dualRoleCrew(), "service", THURSDAY, rules, [])?.label).toBe("Measure");
  });

  it("blocks every other department, not just the paired one", () => {
    expect(getCrewRoleBlock(dualRoleCrew(), "jip", MONDAY, rules, [])?.label).toBe("Service");
  });

  it("leaves every section live when no rule covers the day", () => {
    // Saturday — neither rule applies.
    const saturday = new Date(2026, 9, 10);
    expect(getCrewRoleBlock(dualRoleCrew(), "measure", saturday, rules, [])).toBeNull();
    expect(getCrewRoleBlock(dualRoleCrew(), "service", saturday, rules, [])).toBeNull();
  });

  it("never blocks seconds or management rows", () => {
    expect(getCrewRoleBlock(dualRoleCrew(), "management", MONDAY, rules, [])).toBeNull();
    expect(getCrewRoleBlock(dualRoleCrew(), "install-seconds", MONDAY, rules, [])).toBeNull();
  });
});

describe("isForeignToSection", () => {
  it("marks a service job as foreign in the measure section", () => {
    const appt = makeAppt({ id: "a", appointment_type: "service" });
    expect(isForeignToSection(appt, "measure")).toBe(true);
    expect(isForeignToSection(appt, "tech_measure")).toBe(true);
  });

  it("does not mark a service job as foreign in the service section", () => {
    const appt = makeAppt({ id: "a", appointment_type: "service" });
    expect(isForeignToSection(appt, "service")).toBe(false);
  });

  it("treats install variants as install work", () => {
    const appt = makeAppt({ id: "a", appointment_type: "lswp" });
    expect(isForeignToSection(appt, "install")).toBe(false);
    expect(isForeignToSection(appt, "measure")).toBe(true);
  });

  it("never marks a job site visit foreign — anyone can do one", () => {
    const appt = makeAppt({ id: "a", appointment_type: "job_site_visit" });
    expect(isForeignToSection(appt, "measure")).toBe(false);
    expect(isForeignToSection(appt, "service")).toBe(false);
  });
});
