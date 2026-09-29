/**
 * The Remote row — the extra measure row above 9-10.
 *
 * A remote measure is one the tech did without going out, so it occupies NONE of
 * their day: remote rows stack freely, never conflict (in either direction),
 * carry zero hours, skip the availability gate, and reconcile against rForce on
 * the DATE alone. These tests pin each of those, because every one of them is a
 * place where the normal measure rules would otherwise apply.
 */
import { describe, it, expect } from "vitest";
import {
  MEASURE_ROW_BLOCKS,
  MEASURE_TIME_BLOCKS,
  REMOTE_BLOCK,
  REMOTE_WINDOW,
  appointmentSpansBlock,
  formatAppointmentTimeRange,
  getSpannedBlocks,
  isRemoteMeasure,
  timeBlockLabel,
  timeBlockStartEnd,
} from "./calendar-utils";
import { coerceFixedBlock, deriveOccupancy, resolveScheduleTimes } from "./scheduling-policy";
import { checkSchedulingConflicts } from "./scheduling-validation";
import { checkAvailabilityConflict } from "./availability";
import { resolveMoveTimes } from "./schedule-command";
import { deriveRForceCalendarStatus } from "./rforce-calendar-status";
import { timeBlockMatchesHour } from "./normalize";
import { validateAppointment } from "./scheduling-rules";
import type { Appointment, AvailabilityRule, Crew, RForceOrder } from "./types";

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    crew_id: "crew-1",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "tech_measure",
    scheduled_date: "2026-10-05",
    start_time: "10:00",
    end_time: "12:00",
    time_block: "10-12",
    time_block_end: null,
    duration_days: 1,
    customer_name: "Test Customer",
    address: "123 Main St",
    order_number: null,
    work_order_number: "WO-100",
    product_count: null,
    notes: null,
    status: "scheduled",
    origin: "manual",
    sync_state: "manual_awaiting_rforce",
    version: 1,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    manual_override: false,
    override_source: null,
    salesforce_url: null,
    scheduled_by: null,
    reschedule_reason: null,
    merge_source_wo: null,
    original_entry_snapshot: null,
    last_reconciled_import_id: null,
    ...overrides,
  } as Appointment;
}

function makeRemote(overrides: Partial<Appointment> = {}): Appointment {
  return makeAppointment({
    id: "appt-remote",
    time_block: REMOTE_BLOCK,
    start_time: REMOTE_WINDOW.start,
    end_time: REMOTE_WINDOW.end,
    resource_hours: 0,
    is_full_day: false,
    ...overrides,
  });
}

const measureCrew: Crew = {
  id: "crew-1",
  name: "Crew A",
  crew_type: "measure_tech",
  color: "#000",
  is_active: true,
  notes: null,
  aliases: null,
  manages: null,
  additional_types: null,
  primary_crew_id: null,
  sort_order: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
} as Crew;

describe("the remote row's shape", () => {
  it("sits above the on-site blocks and stays out of block math", () => {
    expect(MEASURE_ROW_BLOCKS[0]).toBe(REMOTE_BLOCK);
    expect(MEASURE_TIME_BLOCKS).not.toContain(REMOTE_BLOCK);
  });

  it("is exact-match only — no measure span reaches it, and it reaches nothing", () => {
    const spanning = makeAppointment({ time_block: "10-12", time_block_end: "2-4" });
    expect(appointmentSpansBlock(spanning, REMOTE_BLOCK)).toBe(false);
    for (const block of MEASURE_TIME_BLOCKS) {
      expect(appointmentSpansBlock(makeRemote(), block)).toBe(false);
    }
    expect(appointmentSpansBlock(makeRemote(), REMOTE_BLOCK)).toBe(true);
    expect(getSpannedBlocks(makeRemote())).toEqual([REMOTE_BLOCK]);
  });

  it("carries a real forward window (the DB requires one) before the 9 AM grid", () => {
    const { start, end } = timeBlockStartEnd(REMOTE_BLOCK);
    expect(start < end).toBe(true);
    expect(end <= timeBlockStartEnd("9-10").start).toBe(true);
  });

  it("reads as 'Remote' on a tile instead of its bookkeeping window", () => {
    expect(formatAppointmentTimeRange(makeRemote())).toBe("Remote");
    expect(timeBlockLabel(REMOTE_BLOCK)).toBe("Remote Measure");
    expect(isRemoteMeasure(makeRemote())).toBe(true);
    expect(isRemoteMeasure(makeAppointment())).toBe(false);
  });
});

describe("occupancy", () => {
  it("occupies zero hours and is never all-day", () => {
    expect(
      deriveOccupancy({
        timeBlock: REMOTE_BLOCK,
        startTime: REMOTE_WINDOW.start,
        endTime: REMOTE_WINDOW.end,
      })
    ).toEqual({ is_full_day: false, resource_hours: 0 });
  });

  it("survives a crew/date move instead of being coerced into 9-10", () => {
    expect(coerceFixedBlock("tech_measure", REMOTE_BLOCK)).toBe(REMOTE_BLOCK);
    expect(resolveScheduleTimes("tech_measure", { timeBlock: REMOTE_BLOCK })).toEqual({
      start: REMOTE_WINDOW.start,
      end: REMOTE_WINDOW.end,
      timeBlock: REMOTE_BLOCK,
    });
  });
});

describe("conflicts", () => {
  const conflictsFor = (
    block: Appointment["time_block"],
    existing: Appointment[],
    opts: Parameters<typeof checkSchedulingConflicts>[7] = {}
  ) =>
    checkSchedulingConflicts("crew-1", "2026-10-05", 1, block, null, existing, undefined, opts);

  it("stacks: a second remote measure on the same tech/day is not a double-book", () => {
    const existing = [makeRemote({ id: "appt-remote-a" })];
    expect(
      conflictsFor(REMOTE_BLOCK, existing, {
        startTime: REMOTE_WINDOW.start,
        endTime: REMOTE_WINDOW.end,
      })
    ).toEqual([]);
  });

  it("does not collide with a booked on-site block", () => {
    const existing = [
      makeAppointment({ time_block: "9-10", start_time: "09:00", end_time: "10:00" }),
    ];
    expect(
      conflictsFor(REMOTE_BLOCK, existing, {
        startTime: REMOTE_WINDOW.start,
        endTime: REMOTE_WINDOW.end,
      })
    ).toEqual([]);
  });

  it("does not collide with an all-day job either way round", () => {
    const allDay = makeAppointment({
      id: "appt-install",
      appointment_type: "install",
      time_block: "full_day",
      is_full_day: true,
      start_time: "08:00",
      end_time: "16:00",
    });
    // A new remote measure against an existing full day…
    expect(
      conflictsFor(REMOTE_BLOCK, [allDay], {
        startTime: REMOTE_WINDOW.start,
        endTime: REMOTE_WINDOW.end,
      })
    ).toEqual([]);
    // …and a new full day over an existing remote measure.
    expect(
      conflictsFor("full_day", [makeRemote()], {
        startTime: "08:00",
        endTime: "16:00",
        isFullDay: true,
      })
    ).toEqual([]);
  });

  it("still guards the on-site grid it sits above", () => {
    const existing = [
      makeAppointment({ time_block: "9-10", start_time: "09:00", end_time: "10:00" }),
    ];
    expect(conflictsFor("9-10", existing, { startTime: "09:00", endTime: "10:00" })).toHaveLength(1);
  });

  it("does not warn about sharing the row in the modal pre-save checks", () => {
    const result = validateAppointment(
      {
        id: "appt-new",
        appointment_type: "tech_measure",
        time_block: REMOTE_BLOCK,
        crew_id: "crew-1",
        scheduled_date: "2026-10-05",
      },
      [makeRemote({ id: "appt-remote-a" })],
      measureCrew,
      [measureCrew]
    );
    expect(result.warnings).toEqual([]);
  });
});

describe("availability", () => {
  const ptoRule: AvailabilityRule = {
    id: "rule-1",
    crew_id: "crew-1",
    kind: "pto",
    department: null,
    start_time: null,
    end_time: null,
    weekdays: [],
    repeat_interval: 1,
    effective_start: "2026-10-05",
    effective_end: "2026-10-05",
    reason: "PTO",
    is_active: true,
    created_by: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };

  it("records a remote measure on a blocked day without demanding an override", () => {
    // It is usually written down after the fact — refusing it would only stop the
    // scheduler from recording work that is already done.
    expect(
      checkAvailabilityConflict("crew-1", "2026-10-05", 1, REMOTE_BLOCK, null, [ptoRule], [], [], {
        start: REMOTE_WINDOW.start,
        end: REMOTE_WINDOW.end,
      })
    ).toBeNull();
    // An on-site block on that same day is still gated.
    expect(
      checkAvailabilityConflict("crew-1", "2026-10-05", 1, "9-10", null, [ptoRule], [], [])
    ).not.toBeNull();
  });
});

describe("moving on and off the row", () => {
  it("a drop on the row stores the remote window", () => {
    const resolved = resolveMoveTimes(
      {
        appointmentId: "appt-1",
        expectedVersion: 1,
        crewId: "crew-1",
        scheduledDate: "2026-10-06",
        timeBlock: REMOTE_BLOCK,
      },
      makeAppointment()
    );
    expect(resolved).toEqual({
      startTime: REMOTE_WINDOW.start,
      endTime: REMOTE_WINDOW.end,
      timeBlock: REMOTE_BLOCK,
      timeBlockEnd: null,
      wantsFullDay: false,
    });
  });

  it("a remote measure keeps the row across a crew or date move", () => {
    const resolved = resolveMoveTimes(
      {
        appointmentId: "appt-remote",
        expectedVersion: 1,
        crewId: "crew-2",
        scheduledDate: "2026-10-07",
      },
      makeRemote()
    );
    expect(resolved.timeBlock).toBe(REMOTE_BLOCK);
  });

  it("dragging it onto the timeline turns it back into a real visit", () => {
    // How a scheduler says "this one needs a trip after all".
    const resolved = resolveMoveTimes(
      {
        appointmentId: "appt-remote",
        expectedVersion: 1,
        crewId: "crew-1",
        scheduledDate: "2026-10-05",
        timeBlock: REMOTE_BLOCK,
        startTime: "14:00",
        exactTime: true,
      },
      makeRemote()
    );
    expect(resolved.timeBlock).toBe("2-4");
    expect(resolved.startTime).toBe("14:00");
  });
});

describe("rForce reconciliation", () => {
  const rforceOrder = (overrides: Partial<RForceOrder> = {}): RForceOrder =>
    ({
      id: "rf-1",
      work_order_number: "WO-100",
      work_order_type: "Tech Measure",
      customer_name: "Test Customer",
      address: "123 Main St",
      scheduled_start: "2026-10-05T10:00:00",
      scheduled_end: "2026-10-05T12:00:00",
      primary_resource: "Crew A",
      ...overrides,
    }) as RForceOrder;

  it("matches on the date alone — rForce's on-site time is not a mismatch", () => {
    const [item] = deriveRForceCalendarStatus([rforceOrder()], [makeRemote()], [], [measureCrew]);
    expect(item.status).toBe("synced");
    expect(timeBlockMatchesHour(REMOTE_BLOCK, 16)).toBe(true);
  });

  it("still flags a different date", () => {
    const [item] = deriveRForceCalendarStatus(
      [rforceOrder({ scheduled_start: "2026-10-08T10:00:00", scheduled_end: "2026-10-08T12:00:00" })],
      [makeRemote()],
      [],
      [measureCrew]
    );
    expect(item.status).toBe("mismatch");
    expect(item.mismatchDetails?.date).toEqual({ app: "2026-10-05", rforce: "2026-10-08" });
    expect(item.mismatchDetails?.time).toBeUndefined();
  });

  it("still flags the wrong tech", () => {
    const [item] = deriveRForceCalendarStatus(
      [rforceOrder({ primary_resource: "Someone Else" })],
      [makeRemote()],
      [],
      [measureCrew]
    );
    expect(item.status).toBe("mismatch");
    expect(item.mismatchDetails?.crew).toEqual({ app: "Crew A", rforce: "Someone Else" });
  });
});
