import { describe, it, expect } from "vitest";
import { parseISO, format, addDays, subDays } from "date-fns";
import { planWindowExtension, type DateWindow } from "./date-window";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** The window loadData() establishes on boot: today-30 .. today+180. */
function bootWindow(today: Date): DateWindow {
  return { start: ymd(subDays(today, 30)), end: ymd(addDays(today, 180)) };
}

const TODAY = parseISO("2026-10-07");

describe("planWindowExtension", () => {
  it("does nothing for a date comfortably inside the window", () => {
    expect(planWindowExtension(bootWindow(TODAY), TODAY)).toBeNull();
    expect(planWindowExtension(bootWindow(TODAY), addDays(TODAY, 30))).toBeNull();
  });

  it("extends backwards without pulling the far end in", () => {
    const boot = bootWindow(TODAY);
    const plan = planWindowExtension(boot, subDays(TODAY, 60));
    expect(plan).not.toBeNull();
    expect(plan!.window.start < boot.start).toBe(true);
    // The regression: the end used to become (clicked + 180), i.e. retreat.
    expect(plan!.window.end).toBe(boot.end);
  });

  it("extends forwards without pushing the near end out", () => {
    const boot = bootWindow(TODAY);
    const plan = planWindowExtension(boot, addDays(TODAY, 200));
    expect(plan).not.toBeNull();
    expect(plan!.window.end > boot.end).toBe(true);
    expect(plan!.window.start).toBe(boot.start);
  });

  it("never shrinks the window, for any date in a wide sweep", () => {
    const boot = bootWindow(TODAY);
    for (let offset = -400; offset <= 400; offset += 7) {
      const plan = planWindowExtension(boot, addDays(TODAY, offset));
      if (!plan) continue;
      expect(plan.window.start <= boot.start).toBe(true);
      expect(plan.window.end >= boot.end).toBe(true);
    }
  });

  it("keeps today loaded when an issue tile six months back is opened", () => {
    // The reported bug: clicking an old issue re-centred the window on that
    // date, dropping every current appointment and unpairing the whole board.
    const boot = bootWindow(TODAY);
    const plan = planWindowExtension(boot, subDays(TODAY, 180));
    expect(plan).not.toBeNull();
    expect(plan!.window.start <= ymd(TODAY)).toBe(true);
    // Asserting ">= today" would be too weak to catch the regression: the old
    // code produced an end of exactly (clicked + 180) == today, which passes
    // that check while still having dropped every future tile. The far edge
    // must not move at all.
    expect(plan!.window.end).toBe(boot.end);
  });

  it("returns gaps that are disjoint from the window already held", () => {
    const boot = bootWindow(TODAY);
    for (const offset of [-365, -120, -40, 200, 400]) {
      const plan = planWindowExtension(boot, addDays(TODAY, offset));
      if (!plan) continue;
      for (const [gapStart, gapEnd] of plan.gaps) {
        expect(gapStart <= gapEnd).toBe(true);
        // No gap may overlap the span we already hold — that would re-download
        // rows we have, which is the egress waste this change removes.
        const overlaps = gapStart <= boot.end && gapEnd >= boot.start;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("covers the whole new window with the old window plus the gaps", () => {
    const boot = bootWindow(TODAY);
    const plan = planWindowExtension(boot, subDays(TODAY, 300));
    expect(plan).not.toBeNull();
    // Walk every day of the grown window; each must be held or in a gap.
    let cursor = parseISO(plan!.window.start);
    const last = parseISO(plan!.window.end);
    while (cursor <= last) {
      const day = ymd(cursor);
      const held = day >= boot.start && day <= boot.end;
      const inGap = plan!.gaps.some(([s, e]) => day >= s && day <= e);
      expect(held || inGap).toBe(true);
      cursor = addDays(cursor, 1);
    }
  });

  it("settles: re-opening the same far date needs no further fetch", () => {
    const boot = bootWindow(TODAY);
    const far = subDays(TODAY, 300);
    const first = planWindowExtension(boot, far);
    expect(first).not.toBeNull();
    expect(planWindowExtension(first!.window, far)).toBeNull();
    // ...and today still needs nothing either, so bouncing back is free.
    expect(planWindowExtension(first!.window, TODAY)).toBeNull();
  });
});
