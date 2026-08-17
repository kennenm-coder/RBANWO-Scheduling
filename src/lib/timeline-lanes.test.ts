import { describe, it, expect } from "vitest";
import { assignTimeLanes } from "./timeline-lanes";

describe("assignTimeLanes", () => {
  it("keeps non-overlapping items in a single lane", () => {
    const { laneOf, laneCount } = assignTimeLanes([
      { id: "a", start_time: "08:00", end_time: "10:00" },
      { id: "b", start_time: "10:00", end_time: "12:00" },
      { id: "c", start_time: "12:00", end_time: "14:00" },
    ]);
    expect(laneCount).toBe(1);
    expect(laneOf.get("a")).toBe(0);
    expect(laneOf.get("b")).toBe(0);
    expect(laneOf.get("c")).toBe(0);
  });

  it("stacks fully-overlapping items into separate lanes", () => {
    const { laneOf, laneCount } = assignTimeLanes([
      { id: "a", start_time: "08:00", end_time: "16:00" },
      { id: "b", start_time: "08:00", end_time: "16:00" },
      { id: "c", start_time: "08:00", end_time: "16:00" },
    ]);
    expect(laneCount).toBe(3);
    expect(new Set([laneOf.get("a"), laneOf.get("b"), laneOf.get("c")]).size).toBe(3);
  });

  it("reuses a lane once the earlier item has ended", () => {
    const { laneOf, laneCount } = assignTimeLanes([
      { id: "a", start_time: "08:00", end_time: "12:00" },
      { id: "b", start_time: "09:00", end_time: "11:00" }, // overlaps a
      { id: "c", start_time: "12:00", end_time: "14:00" }, // starts when a ends → lane 0
    ]);
    expect(laneCount).toBe(2);
    expect(laneOf.get("a")).toBe(0);
    expect(laneOf.get("b")).toBe(1);
    expect(laneOf.get("c")).toBe(0);
  });

  it("treats missing times as a full-day span", () => {
    const { laneCount } = assignTimeLanes([
      { id: "a", start_time: null, end_time: null },
      { id: "b", start_time: "10:00", end_time: "11:00" },
    ]);
    expect(laneCount).toBe(2);
  });

  it("returns one lane for an empty list", () => {
    expect(assignTimeLanes([]).laneCount).toBe(1);
  });
});
