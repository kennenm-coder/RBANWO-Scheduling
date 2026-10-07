import { describe, it, expect, beforeEach } from "vitest";
import { format } from "date-fns";
import {
  calendarStateKey,
  readCalendarViewState,
  writeCalendarViewState,
  restoredDate,
  restoredView,
} from "./calendar-view-state";

beforeEach(() => localStorage.clear());

describe("calendarStateKey", () => {
  it("gives each account its own slot on a shared device", () => {
    expect(calendarStateKey("user-a")).not.toBe(calendarStateKey("user-b"));
  });

  it("falls back to a shared local slot when signed out / dev bypass", () => {
    expect(calendarStateKey(null)).toBe(calendarStateKey(undefined));
  });
});

describe("round trip", () => {
  it("restores the exact day and view that were saved", () => {
    const key = calendarStateKey("user-a");
    writeCalendarViewState(key, { view: "block", date: "2026-11-10" });
    const saved = readCalendarViewState(key);
    expect(restoredView(saved)).toBe("block");
    expect(format(restoredDate(saved), "yyyy-MM-dd")).toBe("2026-11-10");
  });

  it("keeps one account's position out of another's", () => {
    writeCalendarViewState(calendarStateKey("user-a"), { view: "day", date: "2026-11-10" });
    expect(readCalendarViewState(calendarStateKey("user-b"))).toBeNull();
  });
});

describe("fallbacks", () => {
  it("defaults to today in week view with nothing stored", () => {
    const saved = readCalendarViewState(calendarStateKey("fresh"));
    expect(saved).toBeNull();
    expect(restoredView(saved)).toBe("week");
    expect(format(restoredDate(saved), "yyyy-MM-dd")).toBe(format(new Date(), "yyyy-MM-dd"));
  });

  it("ignores a corrupt entry instead of throwing", () => {
    const key = calendarStateKey("user-a");
    localStorage.setItem(key, "{not json");
    expect(readCalendarViewState(key)).toBeNull();
  });

  it("drops an implausible stored date", () => {
    const key = calendarStateKey("user-a");
    localStorage.setItem(key, JSON.stringify({ view: "day", date: "0026-11-10" }));
    expect(readCalendarViewState(key)).toBeNull();
  });

  it("falls back to week for an unknown view mode", () => {
    const key = calendarStateKey("user-a");
    localStorage.setItem(key, JSON.stringify({ view: "month", date: "2026-11-10" }));
    expect(readCalendarViewState(key)?.view).toBe("week");
  });

  it("migrates the pre-namespacing view-only key", () => {
    localStorage.setItem("rbanwo-sched-view", "block");
    const saved = readCalendarViewState(calendarStateKey("user-a"));
    expect(saved?.view).toBe("block");
    expect(saved?.date).toBe(format(new Date(), "yyyy-MM-dd"));
  });
});
