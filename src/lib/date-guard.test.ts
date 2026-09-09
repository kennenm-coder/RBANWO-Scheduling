import { describe, it, expect } from "vitest";
import { isPlausibleScheduleDate, DATE_INPUT_MIN, DATE_INPUT_MAX } from "./date-guard";

describe("isPlausibleScheduleDate", () => {
  it("accepts normal scheduling dates", () => {
    expect(isPlausibleScheduleDate("2026-11-10")).toBe(true);
    expect(isPlausibleScheduleDate("2026-01-01")).toBe(true);
    expect(isPlausibleScheduleDate("2030-12-31")).toBe(true);
  });

  it("rejects the mistyped-year case that caused the invisible-blocker bug", () => {
    // A 2-digit "26" typed into a native date field becomes the year 0026.
    expect(isPlausibleScheduleDate("0026-11-10")).toBe(false);
  });

  it("rejects absurd years outside the allowed window", () => {
    expect(isPlausibleScheduleDate("0226-11-10")).toBe(false);
    expect(isPlausibleScheduleDate("1999-12-31")).toBe(false);
    expect(isPlausibleScheduleDate("2101-01-01")).toBe(false);
  });

  it("rejects blank or malformed values", () => {
    expect(isPlausibleScheduleDate("")).toBe(false);
    expect(isPlausibleScheduleDate(null)).toBe(false);
    expect(isPlausibleScheduleDate(undefined)).toBe(false);
    expect(isPlausibleScheduleDate("2026-11")).toBe(false);
    expect(isPlausibleScheduleDate("11/10/2026")).toBe(false);
    expect(isPlausibleScheduleDate("2026-13-10")).toBe(false);
    expect(isPlausibleScheduleDate("2026-11-40")).toBe(false);
  });

  it("exposes input bounds spanning the allowed window", () => {
    expect(DATE_INPUT_MIN).toBe("2000-01-01");
    expect(DATE_INPUT_MAX).toBe("2100-12-31");
  });
});
