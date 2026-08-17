import { describe, it, expect } from "vitest";
import {
  appointmentSpansBlock,
  getSpannedBlocks,
  getAppointmentsForDay,
  getAppointmentsForCrewAndDay,
  timeBlockLabel,
  formatTime12,
  formatTimeShort,
  formatAppointmentTimeRange,
  humanizeConflictMessage,
  timeBlockStartEnd,
  getTimeBlocksForType,
  timeToBlock,
  MEASURE_TIME_BLOCKS,
  INSTALL_TIME_BLOCKS,
} from "./calendar-utils";
import { Appointment } from "./types";
import { parseISO } from "date-fns";

/** Create a local-timezone Date from YYYY-MM-DD (avoids UTC midnight → previous day issue) */
function localDate(dateStr: string): Date {
  return parseISO(dateStr);
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

describe("appointmentSpansBlock", () => {
  it("returns true for exact match", () => {
    const appt = makeAppt({ id: "a", time_block: "9-10" });
    expect(appointmentSpansBlock(appt, "9-10")).toBe(true);
  });

  it("returns false for different block", () => {
    const appt = makeAppt({ id: "a", time_block: "9-10" });
    expect(appointmentSpansBlock(appt, "10-12")).toBe(false);
  });

  it("returns true for block within span range", () => {
    const appt = makeAppt({ id: "a", time_block: "10-12", time_block_end: "2-4" });
    expect(appointmentSpansBlock(appt, "12-2")).toBe(true);
    expect(appointmentSpansBlock(appt, "2-4")).toBe(true);
  });

  it("returns false for block outside span range", () => {
    const appt = makeAppt({ id: "a", time_block: "10-12", time_block_end: "12-2" });
    expect(appointmentSpansBlock(appt, "4-6")).toBe(false);
    expect(appointmentSpansBlock(appt, "9-10")).toBe(false);
  });

  it("full_day matches full_day", () => {
    const appt = makeAppt({ id: "a", time_block: "full_day" });
    expect(appointmentSpansBlock(appt, "full_day")).toBe(true);
  });
});

describe("getSpannedBlocks", () => {
  it("returns single block when no end", () => {
    const appt = makeAppt({ id: "a", time_block: "9-10" });
    expect(getSpannedBlocks(appt)).toEqual(["9-10"]);
  });

  it("returns range of blocks when end is set", () => {
    const appt = makeAppt({ id: "a", time_block: "10-12", time_block_end: "2-4" });
    expect(getSpannedBlocks(appt)).toEqual(["10-12", "12-2", "2-4"]);
  });

  it("returns empty array when no time_block", () => {
    const appt = makeAppt({ id: "a", time_block: null });
    expect(getSpannedBlocks(appt)).toEqual([]);
  });
});

describe("getAppointmentsForDay", () => {
  it("returns appointments on the given date", () => {
    const appts = [
      makeAppt({ id: "a1", scheduled_date: "2026-08-10" }),
      makeAppt({ id: "a2", scheduled_date: "2026-08-11" }),
    ];
    const result = getAppointmentsForDay(appts, localDate("2026-08-10"));
    expect(result.map((a) => a.id)).toEqual(["a1"]);
  });

  it("excludes cancelled appointments", () => {
    const appts = [
      makeAppt({ id: "a1", scheduled_date: "2026-08-10", status: "cancelled" }),
    ];
    expect(getAppointmentsForDay(appts, localDate("2026-08-10"))).toHaveLength(0);
  });

  it("includes multi-day appointments on spanned dates", () => {
    const appts = [
      makeAppt({ id: "a1", scheduled_date: "2026-08-10", duration_days: 3 }),
    ];
    // Day 1 (start date)
    expect(getAppointmentsForDay(appts, localDate("2026-08-10"))).toHaveLength(1);
    // Day 2
    expect(getAppointmentsForDay(appts, localDate("2026-08-11"))).toHaveLength(1);
    // Day 3
    expect(getAppointmentsForDay(appts, localDate("2026-08-12"))).toHaveLength(1);
    // Day 4 (after end)
    expect(getAppointmentsForDay(appts, localDate("2026-08-13"))).toHaveLength(0);
  });
});

describe("getAppointmentsForCrewAndDay", () => {
  it("filters by primary crew", () => {
    const appts = [
      makeAppt({ id: "a1", crew_id: "crew-1" }),
      makeAppt({ id: "a2", crew_id: "crew-2" }),
    ];
    const result = getAppointmentsForCrewAndDay(appts, "crew-1", localDate("2026-08-10"));
    expect(result.map((a) => a.id)).toEqual(["a1"]);
  });

  it("includes secondary crew", () => {
    const appts = [
      makeAppt({ id: "a1", crew_id: "crew-2", secondary_crew_id: "crew-1" }),
    ];
    const result = getAppointmentsForCrewAndDay(appts, "crew-1", localDate("2026-08-10"));
    expect(result).toHaveLength(1);
  });

  it("includes tertiary crew", () => {
    const appts = [
      makeAppt({ id: "a1", crew_id: "crew-2", tertiary_crew_id: "crew-1" }),
    ];
    const result = getAppointmentsForCrewAndDay(appts, "crew-1", localDate("2026-08-10"));
    expect(result).toHaveLength(1);
  });
});

describe("timeBlockStartEnd", () => {
  it("returns correct times for 9-10", () => {
    expect(timeBlockStartEnd("9-10")).toEqual({ start: "09:00", end: "10:00" });
  });

  it("returns correct times for full_day", () => {
    expect(timeBlockStartEnd("full_day")).toEqual({ start: "08:00", end: "16:00" });
  });
});

describe("getTimeBlocksForType", () => {
  it("returns measure blocks for tech_measure", () => {
    expect(getTimeBlocksForType("tech_measure")).toBe(MEASURE_TIME_BLOCKS);
  });

  it("returns install blocks for install", () => {
    expect(getTimeBlocksForType("install")).toBe(INSTALL_TIME_BLOCKS);
  });
});

describe("timeToBlock", () => {
  it("maps hour 9 to 9-10", () => {
    expect(timeToBlock(9)).toBe("9-10");
  });

  it("maps hour 10 to 10-12", () => {
    expect(timeToBlock(10)).toBe("10-12");
  });

  it("maps hour 14 to 2-4", () => {
    expect(timeToBlock(14)).toBe("2-4");
  });

  it("maps hour 17 to 4-6", () => {
    expect(timeToBlock(17)).toBe("4-6");
  });
});

describe("timeBlockLabel", () => {
  it("returns formatted labels", () => {
    expect(timeBlockLabel("9-10")).toBe("9:00 – 10:00 AM");
    expect(timeBlockLabel("full_day")).toBe("Full Day (8 AM)");
  });
});

describe("humanizeConflictMessage", () => {
  const crews = [{ id: "crew-1", name: "Ryan Benoit-Perz" } as unknown as import("./types").Crew];
  const appts = [
    makeAppt({ id: "9161ae7c-df81-4ef2-ae13-c0a14501d59e", crew_id: "crew-1", customer_name: "Jim Hays", scheduled_date: "2026-08-18", start_time: "12:00", end_time: "14:00", time_block: "12-2" }),
  ];

  it("translates a resource-conflict UUID into who/when/customer", () => {
    const msg = "SCHEDULING_CONFLICT: resource is already assigned to appointment 9161ae7c-df81-4ef2-ae13-c0a14501d59e";
    const out = humanizeConflictMessage(msg, appts, crews);
    expect(out).toContain("Ryan Benoit-Perz");
    expect(out).toContain("Jim Hays");
    expect(out).toContain("12:00 PM");
    expect(out).not.toContain("9161ae7c");
  });

  it("falls back gracefully when the appointment isn't loaded", () => {
    const msg = "SCHEDULING_CONFLICT: resource is already assigned to appointment 00000000-0000-0000-0000-000000000000";
    expect(humanizeConflictMessage(msg, appts, crews)).toBe("That crew is already booked in this slot.");
  });

  it("strips the prefix from other conflict messages", () => {
    expect(humanizeConflictMessage("SCHEDULING_CONFLICT: That crew slot is already booked", appts, crews)).toBe("That crew slot is already booked");
  });
});

describe("formatTimeShort / formatAppointmentTimeRange", () => {
  it("formats compact times", () => {
    expect(formatTimeShort("10:30")).toBe("10:30a");
    expect(formatTimeShort("14:00")).toBe("2p");
    expect(formatTimeShort("16:00")).toBe("4p");
    expect(formatTimeShort("09:00")).toBe("9a");
    expect(formatTimeShort("12:00")).toBe("12p");
    expect(formatTimeShort(null)).toBe("");
  });
  it("formats a start–end range", () => {
    expect(formatAppointmentTimeRange({ start_time: "10:30", end_time: "12:00" })).toBe("10:30a–12p");
    expect(formatAppointmentTimeRange({ start_time: "08:00", end_time: "16:00" })).toBe("8a–4p");
    expect(formatAppointmentTimeRange({ start_time: "10:00", end_time: null })).toBe("10a");
    expect(formatAppointmentTimeRange({ start_time: null, end_time: null })).toBe("");
  });
});

describe("formatTime12", () => {
  it("formats 24-hour times as 12-hour", () => {
    expect(formatTime12("08:00")).toBe("8:00 AM");
    expect(formatTime12("16:00")).toBe("4:00 PM");
    expect(formatTime12("00:00")).toBe("12:00 AM");
    expect(formatTime12("12:30")).toBe("12:30 PM");
    expect(formatTime12("09:05")).toBe("9:05 AM");
  });
  it("handles empty/invalid input", () => {
    expect(formatTime12(null)).toBe("");
    expect(formatTime12("")).toBe("");
    expect(formatTime12("garbage")).toBe("garbage");
  });
});
