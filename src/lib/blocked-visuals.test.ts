import { describe, it, expect } from "vitest";
import {
  blockedVisualFor,
  timeOffVisual,
  blockedCellStyle,
  blockedSlotStyle,
} from "./blocked-visuals";
import type { AvailabilityKind } from "./types";

describe("blockedVisualFor", () => {
  it("gives every blocking reason its own accent", () => {
    const kinds: AvailabilityKind[] = [
      "pto",
      "unavailable",
      "office_day",
      "late_day",
      "holiday",
      "company_meeting",
    ];
    const accents = kinds.map((k) => blockedVisualFor(k).accent);
    // All distinct — the reason has to read at a glance, not just "blocked".
    expect(new Set(accents).size).toBe(kinds.length);
  });

  it("labels each reason in plain words", () => {
    expect(blockedVisualFor("pto").label).toBe("PTO");
    expect(blockedVisualFor("office_day").label).toBe("Office");
    expect(blockedVisualFor("holiday").label).toBe("Holiday");
  });

  it("falls back to the unavailable treatment for an unknown kind", () => {
    expect(blockedVisualFor(undefined).accent).toBe(
      blockedVisualFor("unavailable").accent
    );
  });

  it("uses theme variables so each theme supplies its own color", () => {
    // Hardcoded hexes are what made the cream theme render light-mode amber.
    for (const k of ["pto", "office_day", "holiday"] as AvailabilityKind[]) {
      expect(blockedVisualFor(k).accent).toMatch(/^var\(--blk-/);
    }
  });
});

describe("the viewer's own time-off color", () => {
  it("replaces the PTO accent when set", () => {
    expect(timeOffVisual("#ff00aa").accent).toBe("#ff00aa");
    expect(blockedVisualFor("pto", { timeOffColor: "#ff00aa" }).accent).toBe("#ff00aa");
  });

  it("leaves the other reasons on their theme colors so they stay apart", () => {
    const office = blockedVisualFor("office_day", { timeOffColor: "#ff00aa" });
    expect(office.accent).toBe("var(--blk-office)");
  });

  it("falls back to the theme color when unset", () => {
    expect(timeOffVisual(undefined).accent).toBe("var(--blk-pto)");
  });
});

describe("cell styling", () => {
  it("mixes the tint against the theme background, not a fixed color", () => {
    const style = blockedCellStyle(blockedVisualFor("pto"));
    expect(style.backgroundColor).toContain("color-mix");
    expect(style.backgroundColor).toContain("var(--background)");
    expect(style.backgroundColor).toContain("var(--blk-tint)");
  });

  it("draws the accent bar by default", () => {
    expect(blockedCellStyle(blockedVisualFor("pto")).borderLeft).toContain("3px solid");
  });

  it("omits the bar when asked, for cells sitting mid-row", () => {
    expect(blockedCellStyle(blockedVisualFor("pto"), { edge: false }).borderLeft).toBeUndefined();
  });

  it("uses a lighter wash for a single blocked time block", () => {
    const slot = blockedSlotStyle(blockedVisualFor("company_meeting"));
    // Half the tint: one row greyed inside a day that is otherwise workable.
    expect(slot.backgroundColor).toContain("calc(var(--blk-tint) / 2)");
    expect(slot.borderLeft).toBeUndefined();
  });
});
