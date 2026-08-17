import { describe, it, expect } from "vitest";
import { deriveTimesFromOrder, rforceWallClock } from "./rforce-times";

describe("rforceWallClock", () => {
  it("slices the wall-clock time from a stored timestamptz string", () => {
    expect(rforceWallClock("2026-11-20T08:00:00+00:00")).toBe("08:00");
    expect(rforceWallClock("2026-08-25T12:30:00+00:00")).toBe("12:30");
  });
  it("returns null for empty / malformed input", () => {
    expect(rforceWallClock(null)).toBeNull();
    expect(rforceWallClock(undefined)).toBeNull();
    expect(rforceWallClock("2026-11-20")).toBeNull();
  });
});

describe("deriveTimesFromOrder", () => {
  it("carries exact 1-hour rForce time for a measure and picks the containing block", () => {
    expect(
      deriveTimesFromOrder("2026-08-25T10:00:00+00:00", "2026-08-25T11:00:00+00:00", "tech_measure")
    ).toEqual({ start_time: "10:00", end_time: "11:00", time_block: "10-12" });
  });

  it("maps a measure start hour to its block boundaries", () => {
    expect(
      deriveTimesFromOrder("2026-08-25T12:00:00+00:00", "2026-08-25T13:00:00+00:00", "tech_measure")
    ).toEqual({ start_time: "12:00", end_time: "13:00", time_block: "12-2" });
    expect(
      deriveTimesFromOrder("2026-08-25T16:00:00+00:00", "2026-08-25T17:00:00+00:00", "tech_measure")
    ).toEqual({ start_time: "16:00", end_time: "17:00", time_block: "4-6" });
  });

  it("gives a timed type (service) real times and a null block", () => {
    expect(
      deriveTimesFromOrder("2026-08-28T09:00:00+00:00", "2026-08-28T13:00:00+00:00", "service")
    ).toEqual({ start_time: "09:00", end_time: "13:00", time_block: null });
  });

  it("keeps full_day block for a single-day install but carries its real window", () => {
    expect(
      deriveTimesFromOrder("2026-11-20T08:00:00+00:00", "2026-11-20T16:00:00+00:00", "install")
    ).toEqual({ start_time: "08:00", end_time: "16:00", time_block: "full_day" });
    // A partial single-day install still keeps full_day (its type model) but real times.
    expect(
      deriveTimesFromOrder("2026-11-20T10:00:00+00:00", "2026-11-20T11:00:00+00:00", "install")
    ).toEqual({ start_time: "10:00", end_time: "11:00", time_block: "full_day" });
  });

  it("treats a multi-day install as a genuine full day", () => {
    expect(
      deriveTimesFromOrder("2026-11-19T08:00:00+00:00", "2026-11-20T14:00:00+00:00", "install")
    ).toEqual({ start_time: "08:00", end_time: "16:00", time_block: "full_day" });
  });

  it("returns null (fall back to defaults) for missing / bogus / inverted windows", () => {
    expect(deriveTimesFromOrder(null, null, "service")).toBeNull();
    // 00:00 placeholder time
    expect(
      deriveTimesFromOrder("2026-08-25T00:00:00+00:00", "2026-08-25T01:00:00+00:00", "tech_measure")
    ).toBeNull();
    // start >= end
    expect(
      deriveTimesFromOrder("2026-08-25T14:00:00+00:00", "2026-08-25T14:00:00+00:00", "service")
    ).toBeNull();
    // multi-day for a non-full-day type has no single-day window to carry
    expect(
      deriveTimesFromOrder("2026-08-25T10:00:00+00:00", "2026-08-27T11:00:00+00:00", "service")
    ).toBeNull();
  });
});
