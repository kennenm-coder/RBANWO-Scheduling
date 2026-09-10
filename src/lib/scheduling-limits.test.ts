import { describe, it, expect } from "vitest";
import { clampMultiDaySpan, MAX_MULTI_DAY_SPAN } from "./scheduling-limits";

describe("clampMultiDaySpan", () => {
  it("passes ordinary spans through", () => {
    expect(clampMultiDaySpan(1)).toBe(1);
    expect(clampMultiDaySpan(3)).toBe(3);
    expect(clampMultiDaySpan(MAX_MULTI_DAY_SPAN)).toBe(MAX_MULTI_DAY_SPAN);
  });

  it("caps a long rForce range instead of collapsing it to one day", () => {
    // Approval used to book a 20-day range as a 1-day tile.
    expect(clampMultiDaySpan(20)).toBe(MAX_MULTI_DAY_SPAN);
  });

  it("never returns less than one day", () => {
    expect(clampMultiDaySpan(0)).toBe(1);
    expect(clampMultiDaySpan(-3)).toBe(1);
    expect(clampMultiDaySpan(Number.NaN)).toBe(1);
  });
});
