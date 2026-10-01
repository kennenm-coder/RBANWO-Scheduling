import { describe, it, expect } from "vitest";
import {
  appointmentCrewDates,
  crewDatesForAppointment,
  crewWorksDate,
  describeHelperDays,
  extraCrewDaysOf,
  getSpannedDates,
  normalizeDayOffsets,
} from "./crew-days";
import { Appointment } from "./types";

function makeAppt(overrides: Partial<Appointment> & { id: string }): Appointment {
  return {
    crew_id: "lead",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "install",
    order_number: null,
    work_order_number: null,
    customer_name: "Test Customer",
    address: "123 Main St, Toledo, OH 43604",
    scheduled_date: "2026-10-05",
    start_time: "08:00",
    end_time: "16:00",
    duration_days: 3,
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
    created_at: "2026-10-05T00:00:00Z",
    updated_at: "2026-10-05T00:00:00Z",
    ...overrides,
  };
}

describe("normalizeDayOffsets", () => {
  it("keeps a real subset, sorted and deduped", () => {
    expect(normalizeDayOffsets([2, 0, 2], 3)).toEqual([0, 2]);
  });

  it("collapses the whole span to null — same meaning, one representation", () => {
    expect(normalizeDayOffsets([0, 1, 2], 3)).toBeNull();
  });

  it("collapses an empty list to null rather than unbooking the crew", () => {
    expect(normalizeDayOffsets([], 3)).toBeNull();
  });

  it("drops positions past the end of a shortened span", () => {
    expect(normalizeDayOffsets([0, 2], 2)).toEqual([0]);
  });

  it("falls back to the whole span when nothing survives the clamp", () => {
    expect(normalizeDayOffsets([2], 1)).toBeNull();
  });

  it("ignores junk entries", () => {
    expect(normalizeDayOffsets([-1, 1.5, 1], 3)).toEqual([1]);
  });
});

describe("crew day resolution", () => {
  it("puts the lead on every day of the span", () => {
    const appt = makeAppt({ id: "a" });
    expect(crewDatesForAppointment(appt, "lead")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
  });

  it("puts a helper with no day list on every day — the old behaviour", () => {
    const appt = makeAppt({ id: "a", secondary_crew_id: "helper" });
    expect(crewDatesForAppointment(appt, "helper")).toHaveLength(3);
  });

  it("puts a partial helper only on its own days", () => {
    const appt = makeAppt({
      id: "a",
      secondary_crew_id: "helper",
      secondary_day_offsets: [1],
    });
    expect(crewDatesForAppointment(appt, "helper")).toEqual(["2026-10-06"]);
    expect(crewWorksDate(appt, "helper", "2026-10-05")).toBe(false);
    expect(crewWorksDate(appt, "helper", "2026-10-06")).toBe(true);
    expect(crewWorksDate(appt, "helper", "2026-10-07")).toBe(false);
    // The lead is unaffected by the helper's list.
    expect(crewWorksDate(appt, "lead", "2026-10-05")).toBe(true);
  });

  it("handles non-contiguous days", () => {
    const appt = makeAppt({
      id: "a",
      secondary_crew_id: "helper",
      secondary_day_offsets: [0, 2],
    });
    expect(crewDatesForAppointment(appt, "helper")).toEqual([
      "2026-10-05",
      "2026-10-07",
    ]);
  });

  it("ignores a day list belonging to the other helper slot", () => {
    const appt = makeAppt({
      id: "a",
      secondary_crew_id: "helper-a",
      secondary_day_offsets: [0],
      tertiary_crew_id: "helper-b",
    });
    expect(crewDatesForAppointment(appt, "helper-b")).toHaveLength(3);
  });

  it("returns nothing for a crew that isn't on the job", () => {
    expect(crewDatesForAppointment(makeAppt({ id: "a" }), "stranger")).toEqual([]);
  });

  it("returns nothing for an unplaced appointment", () => {
    const appt = makeAppt({ id: "a", scheduled_date: null });
    expect(crewDatesForAppointment(appt, "lead")).toEqual([]);
    expect(appointmentCrewDates(appt).size).toBe(0);
  });

  it("maps every crew to its own dates", () => {
    const map = appointmentCrewDates(
      makeAppt({
        id: "a",
        secondary_crew_id: "helper",
        secondary_day_offsets: [2],
      })
    );
    expect(map.get("lead")?.size).toBe(3);
    expect([...(map.get("helper") ?? [])]).toEqual(["2026-10-07"]);
  });

  it("keeps the lead on every day even when a stale list names it", () => {
    // A crew in both the lead and a helper slot still owns the whole span.
    const appt = makeAppt({
      id: "a",
      secondary_crew_id: "lead",
      secondary_day_offsets: [1],
    });
    expect(crewDatesForAppointment(appt, "lead")).toHaveLength(3);
  });
});

describe("extraCrewDaysOf", () => {
  it("maps each helper to its list, null for a whole-span helper", () => {
    expect(
      extraCrewDaysOf({
        secondary_crew_id: "a",
        secondary_day_offsets: [1],
        tertiary_crew_id: "b",
        tertiary_day_offsets: null,
      })
    ).toEqual({ a: [1], b: null });
  });

  it("unions the lists when one crew fills both helper slots", () => {
    expect(
      extraCrewDaysOf({
        secondary_crew_id: "a",
        secondary_day_offsets: [0],
        tertiary_crew_id: "a",
        tertiary_day_offsets: [2],
      })
    ).toEqual({ a: [0, 2] });
  });

  it("lets a whole-span slot swallow a partial one for the same crew", () => {
    expect(
      extraCrewDaysOf({
        secondary_crew_id: "a",
        secondary_day_offsets: [0],
        tertiary_crew_id: "a",
        tertiary_day_offsets: null,
      })
    ).toEqual({ a: null });
  });
});

describe("getSpannedDates", () => {
  it("walks the span in order", () => {
    expect(getSpannedDates("2026-10-05", 3)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
  });

  it("treats a zero or negative span as one day", () => {
    expect(getSpannedDates("2026-10-05", 0)).toEqual(["2026-10-05"]);
  });
});

describe("describeHelperDays", () => {
  it("says nothing for a whole-span helper", () => {
    expect(describeHelperDays(null, 3)).toBeNull();
    expect(describeHelperDays([0, 1, 2], 3)).toBeNull();
  });

  it("names a single day", () => {
    expect(describeHelperDays([1], 3)).toBe("Day 2");
  });

  it("names several days", () => {
    expect(describeHelperDays([0, 2], 3)).toBe("Days 1 & 3");
    expect(describeHelperDays([0, 1, 3], 4)).toBe("Days 1, 2 & 4");
  });
});
