import { describe, it, expect } from "vitest";
import {
  normalizeWoType,
  normalizeWoTypeOrUnknown,
  TIME_BLOCK_HOUR,
  extractHour,
  timeBlockMatchesHour,
  CANCELLED_STATUSES,
  COMPLETED_STATUSES,
  SCHEDULED_STATUSES,
  isRForceCancelled,
  firstNamesMatch,
  getRForceResource,
} from "./normalize";

// ── Work-Order Type Normalization ──

describe("normalizeWoType", () => {
  it("normalizes standard rForce type strings", () => {
    expect(normalizeWoType("Tech Measure")).toBe("tech_measure");
    expect(normalizeWoType("Install")).toBe("install");
    expect(normalizeWoType("Service")).toBe("service");
    expect(normalizeWoType("JIP")).toBe("jip");
  });

  it("normalizes JIP aliases", () => {
    expect(normalizeWoType("Job Site Visit")).toBe("jip");
    expect(normalizeWoType("Job Site Visit/JIP")).toBe("jip");
  });

  it("normalizes extended types (LSWP, HOA, Paint/Stain)", () => {
    expect(normalizeWoType("LSWP")).toBe("lswp");
    expect(normalizeWoType("HOA")).toBe("hoa");
    expect(normalizeWoType("Paint/Stain")).toBe("paint_stain");
    expect(normalizeWoType("Paint")).toBe("paint_stain");
    expect(normalizeWoType("Stain")).toBe("paint_stain");
  });

  it("returns null for unrecognized values", () => {
    expect(normalizeWoType("Something Random")).toBeNull();
    expect(normalizeWoType("")).toBeNull();
    expect(normalizeWoType(null)).toBeNull();
    expect(normalizeWoType(undefined)).toBeNull();
  });

  it("handles whitespace-trimmed values", () => {
    expect(normalizeWoType(" Install ")).toBe("install");
    expect(normalizeWoType("  Tech Measure  ")).toBe("tech_measure");
  });

  it("handles case-insensitive values", () => {
    expect(normalizeWoType("install")).toBe("install");
    expect(normalizeWoType("INSTALL")).toBe("install");
    expect(normalizeWoType("tech measure")).toBe("tech_measure");
    expect(normalizeWoType("TECH MEASURE")).toBe("tech_measure");
    expect(normalizeWoType("jip")).toBe("jip");
    expect(normalizeWoType("lswp")).toBe("lswp");
    expect(normalizeWoType("hoa")).toBe("hoa");
    expect(normalizeWoType("paint/stain")).toBe("paint_stain");
    expect(normalizeWoType("SERVICE")).toBe("service");
    expect(normalizeWoType("job site visit")).toBe("jip");
  });
});

describe("normalizeWoTypeOrUnknown", () => {
  it("returns type for known values", () => {
    expect(normalizeWoTypeOrUnknown("Install")).toBe("install");
  });

  it("returns 'unknown' for unrecognized or missing values", () => {
    expect(normalizeWoTypeOrUnknown("xyz")).toBe("unknown");
    expect(normalizeWoTypeOrUnknown(null)).toBe("unknown");
    expect(normalizeWoTypeOrUnknown(undefined)).toBe("unknown");
  });
});

// ── Time Block ↔ Hour ──

describe("extractHour", () => {
  it("extracts hour from ISO datetime", () => {
    expect(extractHour("2026-08-01T14:30:00")).toBe(14);
    expect(extractHour("2026-08-01T09:00:00")).toBe(9);
    expect(extractHour("2026-08-01T00:00:00")).toBe(0);
  });

  it("returns null for invalid input", () => {
    expect(extractHour("2026-08-01")).toBeNull();
    expect(extractHour("no-time")).toBeNull();
  });
});

describe("timeBlockMatchesHour", () => {
  it("matches hours within block range", () => {
    // 9-10 block: hour 9 is valid
    expect(timeBlockMatchesHour("9-10", 9)).toBe(true);
    // 10-12 block: hours 10 and 11 are valid
    expect(timeBlockMatchesHour("10-12", 10)).toBe(true);
    expect(timeBlockMatchesHour("10-12", 11)).toBe(true);
    // 4-6 block: hours 16 and 17 are valid (4:00-5:59 PM)
    expect(timeBlockMatchesHour("4-6", 16)).toBe(true);
    expect(timeBlockMatchesHour("4-6", 17)).toBe(true);
  });

  it("rejects hours outside block range", () => {
    expect(timeBlockMatchesHour("9-10", 10)).toBe(false);
    expect(timeBlockMatchesHour("10-12", 9)).toBe(false);
    expect(timeBlockMatchesHour("4-6", 15)).toBe(false);
    expect(timeBlockMatchesHour("4-6", 18)).toBe(false);
  });

  it("full_day matches any hour", () => {
    expect(timeBlockMatchesHour("full_day", 8)).toBe(true);
    expect(timeBlockMatchesHour("full_day", 14)).toBe(true);
    expect(timeBlockMatchesHour("full_day", 0)).toBe(true);
  });

  it("TIME_BLOCK_HOUR has correct start hours", () => {
    expect(TIME_BLOCK_HOUR["9-10"]).toBe(9);
    expect(TIME_BLOCK_HOUR["10-12"]).toBe(10);
    expect(TIME_BLOCK_HOUR["12-2"]).toBe(12);
    expect(TIME_BLOCK_HOUR["2-4"]).toBe(14);
    expect(TIME_BLOCK_HOUR["4-6"]).toBe(16);
    expect(TIME_BLOCK_HOUR["full_day"]).toBe(8);
  });
});

// ── Status Classification ──

describe("status sets", () => {
  it("CANCELLED_STATUSES includes both spellings", () => {
    expect(CANCELLED_STATUSES.has("Canceled")).toBe(true);
    expect(CANCELLED_STATUSES.has("Cancelled")).toBe(true);
    expect(CANCELLED_STATUSES.has("cancelled")).toBe(false); // case-sensitive
  });

  it("COMPLETED_STATUSES includes the rForce closed status", () => {
    expect(COMPLETED_STATUSES.has("Appt Complete / Closed")).toBe(true);
  });

  it("SCHEDULED_STATUSES includes both variants", () => {
    expect(SCHEDULED_STATUSES.has("Scheduled & Assigned")).toBe(true);
    expect(SCHEDULED_STATUSES.has("Scheduled")).toBe(true);
  });
});

describe("isRForceCancelled", () => {
  it("returns true for cancelled wo_status", () => {
    expect(isRForceCancelled({ wo_status: "Canceled" })).toBe(true);
    expect(isRForceCancelled({ wo_status: "Cancelled" })).toBe(true);
  });

  it("returns true for cancelled order_status", () => {
    expect(isRForceCancelled({ order_status: "Canceled" })).toBe(true);
  });

  it("returns false for non-cancelled", () => {
    expect(isRForceCancelled({ wo_status: "Scheduled" })).toBe(false);
    expect(isRForceCancelled({})).toBe(false);
    expect(isRForceCancelled({ wo_status: null, order_status: null })).toBe(false);
  });
});

// ── Resource Comparison ──

describe("firstNamesMatch", () => {
  it("matches same first names case-insensitively", () => {
    expect(firstNamesMatch("Ryan Smith", "ryan jones")).toBe(true);
    expect(firstNamesMatch("Sam", "Sam Mormon")).toBe(true);
  });

  it("does not match different first names", () => {
    expect(firstNamesMatch("Ryan", "Nate")).toBe(false);
  });

  it("returns true when either name is null/undefined (non-comparable)", () => {
    expect(firstNamesMatch(null, "Ryan")).toBe(true);
    expect(firstNamesMatch("Ryan", null)).toBe(true);
    expect(firstNamesMatch(null, null)).toBe(true);
    expect(firstNamesMatch(undefined, undefined)).toBe(true);
  });
});

describe("getRForceResource", () => {
  it("returns primary_resource first", () => {
    expect(getRForceResource({
      primary_resource: "Sam Mormon",
      installer: "Other Person",
    })).toBe("Sam Mormon");
  });

  it("falls back through the chain", () => {
    expect(getRForceResource({ tech_measure_name: "Ryan" })).toBe("Ryan");
    expect(getRForceResource({ installer: "Keith" })).toBe("Keith");
    expect(getRForceResource({ service_rep: "Matt" })).toBe("Matt");
  });

  it("returns null when all fields are missing", () => {
    expect(getRForceResource({})).toBeNull();
    expect(getRForceResource({ primary_resource: null })).toBeNull();
  });
});
