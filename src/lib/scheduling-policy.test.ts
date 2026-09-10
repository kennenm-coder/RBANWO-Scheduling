import { describe, it, expect } from "vitest";
import {
  getSchedulingMode,
  isFixedBlock,
  isTimed,
  isFullDay,
  getDefaultTimes,
  getValidBlocks,
  resolveScheduleTimes,
  getNextAvailableStart,
  snapTo30Min,
  addMinutesToTime,
  timeDurationMinutes,
  coerceFixedBlock,
  isValidTimeRange,
} from "./scheduling-policy";
import { AppointmentType } from "./types";

describe("coerceFixedBlock — a measure is never full_day", () => {
  it("keeps a real measure block", () => {
    expect(coerceFixedBlock("tech_measure", "2-4")).toBe("2-4");
  });

  it("coerces full_day / missing to the first measure block (the Day-view lane-click case)", () => {
    expect(coerceFixedBlock("tech_measure", "full_day")).toBe("9-10");
    expect(coerceFixedBlock("tech_measure", null)).toBe("9-10");
    expect(coerceFixedBlock("tech_measure", undefined)).toBe("9-10");
  });

  it("leaves non-measure types alone", () => {
    expect(coerceFixedBlock("install", "full_day")).toBe("full_day");
    expect(coerceFixedBlock("service", null)).toBe("full_day");
  });
});

describe("resolveScheduleTimes never stores a measure as full_day", () => {
  it("falls back to the first block when handed full_day", () => {
    expect(resolveScheduleTimes("tech_measure", { timeBlock: "full_day" })).toEqual({
      start: "09:00",
      end: "10:00",
      timeBlock: "9-10",
    });
  });

  it("falls back to the first block when handed nothing", () => {
    expect(resolveScheduleTimes("tech_measure", {}).timeBlock).toBe("9-10");
  });
});

describe("isValidTimeRange", () => {
  it("accepts a forward window (HH:MM or HH:MM:SS)", () => {
    expect(isValidTimeRange("09:00", "10:00")).toBe(true);
    expect(isValidTimeRange("09:00:00", "10:30:00")).toBe(true);
  });

  it("rejects an end at or before the start, and missing ends", () => {
    expect(isValidTimeRange("17:00", "09:00")).toBe(false);
    expect(isValidTimeRange("10:00", "10:00")).toBe(false);
    expect(isValidTimeRange("10:00", null)).toBe(false);
    expect(isValidTimeRange(null, "10:00")).toBe(false);
  });
});

describe("time arithmetic stays inside the day", () => {
  it("snapTo30Min does not round up to the invalid 24:00", () => {
    expect(snapTo30Min("23:45")).toBe("23:30");
  });

  it("addMinutesToTime clamps to 23:59 instead of landing on the start", () => {
    expect(addMinutesToTime("23:30", 60)).toBe("23:59");
  });
});

describe("getSchedulingMode", () => {
  it("returns fixed_block for tech_measure", () => {
    expect(getSchedulingMode("tech_measure")).toBe("fixed_block");
  });

  it("returns full_day for install", () => {
    expect(getSchedulingMode("install")).toBe("full_day");
  });

  it("returns full_day for lswp", () => {
    expect(getSchedulingMode("lswp")).toBe("full_day");
  });

  it("returns timed for service", () => {
    expect(getSchedulingMode("service")).toBe("timed");
  });

  it("returns timed for jip", () => {
    expect(getSchedulingMode("jip")).toBe("timed");
  });

  it("returns timed for hoa", () => {
    expect(getSchedulingMode("hoa")).toBe("timed");
  });

  it("returns timed for paint_stain", () => {
    expect(getSchedulingMode("paint_stain")).toBe("timed");
  });
});

describe("mode helpers", () => {
  it("isFixedBlock only for tech_measure", () => {
    expect(isFixedBlock("tech_measure")).toBe(true);
    expect(isFixedBlock("service")).toBe(false);
    expect(isFixedBlock("install")).toBe(false);
  });

  it("isTimed for service/jip/hoa/paint_stain", () => {
    expect(isTimed("service")).toBe(true);
    expect(isTimed("jip")).toBe(true);
    expect(isTimed("hoa")).toBe(true);
    expect(isTimed("paint_stain")).toBe(true);
    expect(isTimed("tech_measure")).toBe(false);
    expect(isTimed("install")).toBe(false);
  });

  it("isFullDay for install/lswp", () => {
    expect(isFullDay("install")).toBe(true);
    expect(isFullDay("lswp")).toBe(true);
    expect(isFullDay("service")).toBe(false);
  });
});

describe("getDefaultTimes", () => {
  it("returns 09:00-18:00 for fixed_block", () => {
    const t = getDefaultTimes("tech_measure");
    expect(t.start).toBe("09:00");
    expect(t.end).toBe("18:00");
  });

  it("returns 08:00-17:00 for timed", () => {
    const t = getDefaultTimes("service");
    expect(t.start).toBe("08:00");
    expect(t.end).toBe("17:00");
  });

  it("returns 08:00-16:00 for full_day", () => {
    const t = getDefaultTimes("install");
    expect(t.start).toBe("08:00");
    expect(t.end).toBe("16:00");
  });
});

describe("getValidBlocks", () => {
  it("returns measure blocks for fixed_block types", () => {
    const blocks = getValidBlocks("tech_measure");
    expect(blocks).not.toBeNull();
    expect(blocks).toContain("9-10");
    expect(blocks).toContain("10-12");
    expect(blocks).toContain("12-2");
    expect(blocks).toContain("2-4");
    expect(blocks).toContain("4-6");
  });

  it("returns null for timed types", () => {
    expect(getValidBlocks("service")).toBeNull();
  });

  it("returns null for full_day types", () => {
    expect(getValidBlocks("install")).toBeNull();
  });
});

describe("resolveScheduleTimes", () => {
  it("resolves fixed_block from time block", () => {
    const r = resolveScheduleTimes("tech_measure", { timeBlock: "10-12" });
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("12:00");
    expect(r.timeBlock).toBe("10-12");
  });

  it("resolves timed with provided start/end", () => {
    const r = resolveScheduleTimes("service", { startTime: "10:30", endTime: "14:00" });
    expect(r.start).toBe("10:30");
    expect(r.end).toBe("14:00");
    expect(r.timeBlock).toBeNull();
  });

  it("resolves timed with defaults when no times provided", () => {
    const r = resolveScheduleTimes("service", {});
    expect(r.start).toBe("08:00");
    expect(r.end).toBe("17:00");
  });

  it("resolves full_day with workday defaults", () => {
    const r = resolveScheduleTimes("install", {});
    expect(r.start).toBe("08:00");
    expect(r.end).toBe("16:00");
    expect(r.timeBlock).toBe("full_day");
  });

  it("resolves full_day with custom start/end", () => {
    const r = resolveScheduleTimes("install", { startTime: "07:00", endTime: "15:00" });
    expect(r.start).toBe("07:00");
    expect(r.end).toBe("15:00");
    expect(r.timeBlock).toBe("full_day");
  });
});

describe("getNextAvailableStart", () => {
  it("returns department default when no existing appointments", () => {
    expect(getNextAvailableStart([], "service")).toBe("08:00");
    expect(getNextAvailableStart([], "tech_measure")).toBe("09:00");
  });

  it("returns latest end time when existing appointments", () => {
    expect(getNextAvailableStart(["10:00", "14:00", "12:00"], "service")).toBe("14:00");
  });

  it("handles single appointment", () => {
    expect(getNextAvailableStart(["11:30"], "service")).toBe("11:30");
  });
});

describe("snapTo30Min", () => {
  it("snaps to nearest 30 minutes", () => {
    expect(snapTo30Min("10:00")).toBe("10:00");
    expect(snapTo30Min("10:14")).toBe("10:00");
    expect(snapTo30Min("10:15")).toBe("10:30");
    expect(snapTo30Min("10:17")).toBe("10:30");
    expect(snapTo30Min("10:30")).toBe("10:30");
    expect(snapTo30Min("10:44")).toBe("10:30");
    expect(snapTo30Min("10:45")).toBe("11:00");
  });

  it("handles hour rollover", () => {
    expect(snapTo30Min("09:45")).toBe("10:00");
  });
});

describe("addMinutesToTime", () => {
  it("adds minutes within same hour", () => {
    expect(addMinutesToTime("08:00", 30)).toBe("08:30");
  });

  it("adds minutes crossing hour boundary", () => {
    expect(addMinutesToTime("08:45", 30)).toBe("09:15");
  });

  it("adds large durations", () => {
    expect(addMinutesToTime("08:00", 120)).toBe("10:00");
    expect(addMinutesToTime("08:00", 480)).toBe("16:00");
  });

  it("clamps to the last minute of the day", () => {
    // Overflow past midnight stops at 23:59 (never wraps, never lands on the start).
    expect(addMinutesToTime("22:00", 180)).toBe("23:59");
  });
});

describe("timeDurationMinutes", () => {
  it("calculates duration between times", () => {
    expect(timeDurationMinutes("08:00", "17:00")).toBe(540);
    expect(timeDurationMinutes("10:00", "12:00")).toBe(120);
    expect(timeDurationMinutes("08:30", "09:00")).toBe(30);
  });
});
