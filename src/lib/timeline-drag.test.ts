import { describe, it, expect } from "vitest";
import {
  calculateTimelineDrag,
  DAY_VIEW_SNAP_MINUTES,
  parseTimeToMinutes,
  getDurationMinutes,
  TimelineDragInput,
} from "./timeline-drag";

// Day timeline: 04:00 (240) → 22:00 (1320), span 1080 min.
// Lane is 1080px wide at left=0, so 1px === 1min and clientX === startMinutes - 240.
const START = 240;
const END = 1320;

function baseInput(overrides: Partial<TimelineDragInput> = {}): TimelineDragInput {
  return {
    pointerClientX: 0,
    laneLeft: 0,
    laneWidth: 1080,
    timelineStartMinutes: START,
    timelineEndMinutes: END,
    appointmentDurationMinutes: 60,
    grabOffsetMinutes: 0,
    snapMinutes: DAY_VIEW_SNAP_MINUTES,
    ...overrides,
  };
}

/** clientX that places the pointer at the given minutes-since-midnight. */
function xAt(minutes: number): number {
  return minutes - START;
}

describe("calculateTimelineDrag", () => {
  it("1. pointer at 9:00 calculates 9:00", () => {
    const r = calculateTimelineDrag(baseInput({ pointerClientX: xAt(540) }));
    expect(r.startTime).toBe("09:00");
    expect(r.endTime).toBe("10:00");
  });

  it("2. pointer at 9:07 snaps down to 9:00", () => {
    const r = calculateTimelineDrag(baseInput({ pointerClientX: xAt(547) }));
    expect(r.startTime).toBe("09:00");
  });

  it("3. pointer at 9:08 snaps up to 9:15", () => {
    const r = calculateTimelineDrag(baseInput({ pointerClientX: xAt(548) }));
    expect(r.startTime).toBe("09:15");
  });

  it("4. grabbing the center keeps the center under the pointer", () => {
    const pointerMinutes = 600; // 10:00
    const r = calculateTimelineDrag(
      baseInput({ pointerClientX: xAt(pointerMinutes), grabOffsetMinutes: 30 })
    );
    expect(r.startTime).toBe("09:30");
    // center of the placed card sits at the pointer
    expect(r.startMinutes + 30).toBe(pointerMinutes);
  });

  it("5. grabbing the right edge preserves the right-edge offset", () => {
    const pointerMinutes = 600; // 10:00
    const r = calculateTimelineDrag(
      baseInput({ pointerClientX: xAt(pointerMinutes), grabOffsetMinutes: 60 })
    );
    expect(r.startTime).toBe("09:00");
    expect(r.endMinutes).toBe(pointerMinutes); // right edge under the pointer
  });

  it("6. dragging before the timeline clamps to 4:00 AM", () => {
    const r = calculateTimelineDrag(baseInput({ pointerClientX: -1000 }));
    expect(r.startTime).toBe("04:00");
    expect(r.startMinutes).toBe(START);
  });

  it("7. dragging near the end preserves duration and clamps start", () => {
    const r = calculateTimelineDrag(
      baseInput({ pointerClientX: xAt(1290), appointmentDurationMinutes: 120 })
    );
    expect(r.startTime).toBe("20:00"); // 1200, the latest start for a 2h appt
    expect(r.endTime).toBe("22:00");
    expect(r.endMinutes - r.startMinutes).toBe(120);
  });

  it("8. horizontal scrolling does not change the result", () => {
    const unscrolled = calculateTimelineDrag(baseInput({ pointerClientX: 300, laneLeft: 0 }));
    // Scroll left by 200px: both the pointer and the lane rect shift together.
    const scrolled = calculateTimelineDrag(baseInput({ pointerClientX: 100, laneLeft: -200 }));
    expect(scrolled.startTime).toBe(unscrolled.startTime);
    expect(scrolled.startMinutes).toBe(unscrolled.startMinutes);
  });

  it("9. a 90-minute appointment stays 90 minutes", () => {
    const r = calculateTimelineDrag(
      baseInput({ pointerClientX: xAt(720), appointmentDurationMinutes: 90 })
    );
    expect(r.endMinutes - r.startMinutes).toBe(90);
    expect(getDurationMinutes(r.startTime, r.endTime)).toBe(90);
  });

  it("10. invalid duration throws", () => {
    expect(() => calculateTimelineDrag(baseInput({ appointmentDurationMinutes: 0 }))).toThrow(
      RangeError
    );
    expect(() => calculateTimelineDrag(baseInput({ appointmentDurationMinutes: -30 }))).toThrow(
      RangeError
    );
  });

  it("11. percent positioning matches the calculated time", () => {
    const r = calculateTimelineDrag(baseInput({ pointerClientX: xAt(540) }));
    expect(r.leftPercent).toBeCloseTo(((r.startMinutes - START) / (END - START)) * 100, 6);
    expect(r.widthPercent).toBeCloseTo((60 / (END - START)) * 100, 6);
  });

  it("12. preview and final drop produce identical values", () => {
    const input = baseInput({ pointerClientX: xAt(613), grabOffsetMinutes: 22 });
    expect(calculateTimelineDrag(input)).toEqual(calculateTimelineDrag(input));
  });

  it("never produces a malformed time such as 23:75 at the boundary", () => {
    const r = calculateTimelineDrag(
      baseInput({ pointerClientX: 99999, appointmentDurationMinutes: 45 })
    );
    expect(r.endTime).toMatch(/^\d{2}:[0-5]\d$/);
    expect(r.startTime).toMatch(/^\d{2}:[0-5]\d$/);
  });

  it("flags an appointment longer than the timeline as overflowing", () => {
    const r = calculateTimelineDrag(
      baseInput({ pointerClientX: xAt(600), appointmentDurationMinutes: END - START + 60 })
    );
    expect(r.overflowsTimeline).toBe(true);
    expect(r.startMinutes).toBe(START);
  });
});

describe("parseTimeToMinutes", () => {
  it("parses HH:MM", () => {
    expect(parseTimeToMinutes("09:15")).toBe(555);
    expect(parseTimeToMinutes("00:00")).toBe(0);
  });
  it("tolerates seconds", () => {
    expect(parseTimeToMinutes("09:15:30")).toBe(555);
  });
});
