import { describe, it, expect } from "vitest";
import { getBlockedTimeBlocks } from "./crew-utils";
import type { Appointment } from "./types";

const base = {
  crew_id: "crew-1",
  secondary_crew_id: null,
  tertiary_crew_id: null,
  scheduled_date: "2026-08-10",
  duration_days: 1,
  status: "scheduled",
  time_block_end: null,
} as Partial<Appointment>;

const appt = (o: Partial<Appointment>): Appointment => ({ ...base, ...o } as Appointment);

describe("getBlockedTimeBlocks — timed work blocks only the blocks it touches", () => {
  it("a 1-hour service no longer greys out the whole measure lane", () => {
    const blocked = getBlockedTimeBlocks("crew-1", [
      appt({ id: "svc", appointment_type: "service", time_block: null, start_time: "13:00", end_time: "14:00" }),
    ], "2026-08-10");
    expect([...blocked]).toEqual(["12-2"]);
  });

  it("a timed job straddling two blocks blocks both", () => {
    const blocked = getBlockedTimeBlocks("crew-1", [
      appt({ id: "svc", appointment_type: "service", time_block: null, start_time: "11:00", end_time: "13:00" }),
    ], "2026-08-10");
    expect([...blocked].sort()).toEqual(["10-12", "12-2"]);
  });

  it("an all-day install (is_full_day) still blocks everything", () => {
    const blocked = getBlockedTimeBlocks("crew-1", [
      appt({ id: "inst", appointment_type: "install", time_block: "full_day", is_full_day: true, start_time: "08:00", end_time: "16:00" }),
    ], "2026-08-10");
    expect(blocked.has("full_day")).toBe(true);
    expect(blocked.has("9-10")).toBe(true);
    expect(blocked.has("4-6")).toBe(true);
  });

  it("a measure span blocks its blocks", () => {
    const blocked = getBlockedTimeBlocks("crew-1", [
      appt({ id: "m", appointment_type: "tech_measure", time_block: "10-12", time_block_end: "2-4", start_time: "10:00", end_time: "16:00" }),
    ], "2026-08-10");
    expect([...blocked].sort()).toEqual(["10-12", "12-2", "2-4"]);
  });
});
