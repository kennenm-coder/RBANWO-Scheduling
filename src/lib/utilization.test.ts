import { describe, it, expect } from "vitest";
import {
  buildWeightMap,
  computeUtilization,
  formatPoints,
  isInstallerCrew,
  sortByUtilization,
  summarizeCoverage,
  summarizeOpenDays,
  tallyBreakdown,
  tallyPoints,
  utilizationBand,
  TALLY_BUCKETS,
  type InstallTally,
  type LoadWeight,
  type UtilizationSettings,
} from "./utilization";
import type { Appointment, Crew } from "./types";

/** The seeded weights from migration 20261008_001. */
const WEIGHTS: LoadWeight[] = [
  { product_key: "window", frame_key: "IF", points: 2 },
  { product_key: "window", frame_key: "FF", points: 3 },
  { product_key: "window", frame_key: "EJ", points: 3 },
  { product_key: "specialty", frame_key: "IF", points: 3 },
  { product_key: "specialty", frame_key: "FF", points: 4 },
  { product_key: "specialty", frame_key: "EJ", points: 4 },
  { product_key: "patio_door", frame_key: "NA", points: 6 },
  { product_key: "entry_door", frame_key: "NA", points: 6 },
  { product_key: "storm_door", frame_key: "NA", points: 2 },
  { product_key: "screen", frame_key: "NA", points: 1 },
  { product_key: "other", frame_key: "NA", points: 0 },
];

const weights = buildWeightMap(WEIGHTS);

const SETTINGS: UtilizationSettings = {
  target_points_per_day: 12,
  goal_utilization_pct: 85,
  legacy_points_per_day: 6,
  // Off by default in the fixtures so existing per-day expectations hold; the
  // unit-based tests opt in explicitly.
  legacy_points_per_unit: 0,
};

function makeTally(overrides: Partial<InstallTally> = {}): InstallTally {
  const base: InstallTally = {
    job_id: "job-1",
    order_number: "PO-1",
    windows_if: 0,
    windows_ff: 0,
    windows_ej: 0,
    specialty_if: 0,
    specialty_ff: 0,
    specialty_ej: 0,
    patio_doors: 0,
    entry_doors: 0,
    storm_doors: 0,
    screens: 0,
    other_units: 0,
    total_units: 0,
    doc_version: 1,
    built_at: "2026-10-01T00:00:00Z",
  };
  const merged = { ...base, ...overrides };
  // Keep the fixture honest about the invariant the migration enforces.
  if (overrides.total_units === undefined) {
    merged.total_units =
      merged.windows_if +
      merged.windows_ff +
      merged.windows_ej +
      merged.specialty_if +
      merged.specialty_ff +
      merged.specialty_ej +
      merged.patio_doors +
      merged.entry_doors +
      merged.storm_doors +
      merged.screens +
      merged.other_units;
  }
  return merged;
}

function makeCrew(overrides: Partial<Crew> & { id: string; name: string }): Crew {
  return {
    crew_type: "install_in_house",
    color: "#2563eb",
    is_active: true,
    notes: null,
    aliases: null,
    manages: null,
    additional_types: null,
    primary_crew_id: null,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAppt(overrides: Partial<Appointment> & { id: string }): Appointment {
  return {
    crew_id: "lead",
    secondary_crew_id: null,
    tertiary_crew_id: null,
    appointment_type: "install",
    order_number: "PO-1",
    work_order_number: "WO-1",
    customer_name: "Test Customer",
    address: "123 Main St, Toledo, OH 43604",
    scheduled_date: "2026-10-05",
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
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const neverOff = (): string | null => null;

// ─── The calibration anchors ────────────────────────────────────────────────
// These are the numbers Kennen set. If any of them stops equalling 12, the
// weight table has drifted away from what a full install day actually means.

describe("the 12-point day", () => {
  it("6 insert windows is exactly one day", () => {
    expect(tallyPoints(makeTally({ windows_if: 6 }), weights)).toBe(12);
  });

  it("4 full-frame windows is exactly one day", () => {
    expect(tallyPoints(makeTally({ windows_ff: 4 }), weights)).toBe(12);
  });

  it("2 entry doors is exactly one day", () => {
    expect(tallyPoints(makeTally({ entry_doors: 2 }), weights)).toBe(12);
  });

  it("2 patio doors is exactly one day", () => {
    expect(tallyPoints(makeTally({ patio_doors: 2 }), weights)).toBe(12);
  });

  it("mixes add up predictably — 3 inserts + 2 full frames is one day", () => {
    expect(tallyPoints(makeTally({ windows_if: 3, windows_ff: 2 }), weights)).toBe(12);
  });

  it("one entry door + 3 inserts is one day", () => {
    expect(tallyPoints(makeTally({ entry_doors: 1, windows_if: 3 }), weights)).toBe(12);
  });
});

describe("tallyPoints", () => {
  it("is zero for an empty tally", () => {
    expect(tallyPoints(makeTally(), weights)).toBe(0);
  });

  it("scores unclassified units at zero but still sees them", () => {
    const tally = makeTally({ other_units: 5 });
    expect(tallyPoints(tally, weights)).toBe(0);
    expect(tally.total_units).toBe(5);
  });

  it("treats a missing weight as zero rather than NaN", () => {
    const sparse = buildWeightMap([{ product_key: "window", frame_key: "IF", points: 2 }]);
    expect(tallyPoints(makeTally({ windows_if: 1, entry_doors: 1 }), sparse)).toBe(2);
  });

  it("counts every bucket the tally exposes", () => {
    // Guards the gap this list exists to prevent: a column added to the
    // migration but not to TALLY_BUCKETS would silently score zero.
    const all = makeTally({
      windows_if: 1,
      windows_ff: 1,
      windows_ej: 1,
      specialty_if: 1,
      specialty_ff: 1,
      specialty_ej: 1,
      patio_doors: 1,
      entry_doors: 1,
      storm_doors: 1,
      screens: 1,
      other_units: 1,
    });
    expect(all.total_units).toBe(TALLY_BUCKETS.length);
    expect(tallyPoints(all, weights)).toBe(2 + 3 + 3 + 3 + 4 + 4 + 6 + 6 + 2 + 1 + 0);
  });
});

describe("tallyBreakdown", () => {
  it("lists only non-zero buckets, with their points", () => {
    const rows = tallyBreakdown(makeTally({ windows_if: 4, entry_doors: 1 }), weights);
    expect(rows).toEqual([
      { product: "window", frame: "IF", label: "Insert windows", short: "W-IF", count: 4, points: 8 },
      { product: "entry_door", frame: "NA", label: "Entry doors", short: "ED", count: 1, points: 6 },
    ]);
  });
});

// ─── Day classification ─────────────────────────────────────────────────────

describe("computeUtilization — day classes", () => {
  const crew = makeCrew({ id: "lead", name: "Sam" });

  function run(appointments: Appointment[], tallies: InstallTally[], isOff = neverOff) {
    return computeUtilization({
      crews: [crew],
      dates: ["2026-10-05"],
      appointments,
      tallyByOrder: new Map(tallies.map((t) => [t.order_number!, t])),
      weights,
      settings: SETTINGS,
      isOff,
    })[0];
  }

  it("a full day of install work reads 100%", () => {
    const row = run([makeAppt({ id: "a" })], [makeTally({ windows_if: 6 })]);
    expect(row.days[0].dayClass).toBe("measurable");
    expect(row.days[0].points).toBe(12);
    expect(row.utilizationPct).toBe(100);
    expect(row.underGoalDays).toBe(0);
  });

  it("a light day reads under goal", () => {
    const row = run([makeAppt({ id: "a" })], [makeTally({ windows_if: 3 })]);
    expect(row.days[0].points).toBe(6);
    expect(row.utilizationPct).toBe(50);
    expect(row.underGoalDays).toBe(1);
  });

  it("an empty available day is idle, and counts against capacity", () => {
    const row = run([], []);
    expect(row.days[0].dayClass).toBe("idle");
    expect(row.capacity).toBe(12);
    expect(row.utilizationPct).toBe(0);
    expect(row.idleDays).toBe(1);
  });

  it("a day off carries no capacity and no utilization", () => {
    const row = run([], [], () => "PTO");
    expect(row.days[0].dayClass).toBe("off");
    expect(row.days[0].offReason).toBe("PTO");
    expect(row.capacity).toBe(0);
    expect(row.utilizationPct).toBeNull();
    expect(row.offDays).toBe(1);
  });

  it("service work consumes the day but carries no product load", () => {
    const row = run([makeAppt({ id: "a", appointment_type: "service", order_number: null })], []);
    expect(row.days[0].dayClass).toBe("non_install");
    expect(row.capacity).toBe(12);
    expect(row.utilizationPct).toBe(0);
    expect(row.nonInstallDays).toBe(1);
    // A service call is not a legacy deal — it never had a material list to miss.
    expect(row.legacyJobs).toHaveLength(0);
    expect(row.days[0].jobs[0].estimated).toBe(false);
  });

  it("a legacy deal is estimated at the legacy rate, not excluded", () => {
    // Legacy deals used to drop the whole day from the ratio, which left an
    // installer carrying old work looking blank instead of busy.
    const row = run([makeAppt({ id: "a", order_number: "PO-NOPE" })], []);
    expect(row.days[0].dayClass).toBe("estimated");
    expect(row.days[0].points).toBe(6);
    expect(row.capacity).toBe(12);
    expect(row.utilizationPct).toBe(50);
    expect(row.estimatedDays).toBe(1);
    expect(row.legacyJobs.map((j) => j.appointmentId)).toEqual(["a"]);
    expect(row.days[0].jobs[0].estimated).toBe(true);
  });

  it("a legacy deal is worth the rate for every day it runs", () => {
    const row = computeUtilization({
      crews: [makeCrew({ id: "lead", name: "Sam" })],
      dates: ["2026-10-05", "2026-10-06", "2026-10-07"],
      appointments: [makeAppt({ id: "a", duration_days: 3, order_number: "PO-NOPE" })],
      tallyByOrder: new Map(),
      weights,
      settings: SETTINGS,
      isOff: neverOff,
    })[0];
    // 6 x 3 days = 18 points, spread back over the 3 days worked.
    expect(row.days[0].jobs[0].jobPoints).toBe(18);
    expect(row.days.map((d) => d.points)).toEqual([6, 6, 6]);
  });

  it("one legacy deal marks the whole day estimated, mixed with a real one", () => {
    const row = run(
      [
        makeAppt({ id: "a", order_number: "PO-1" }),
        makeAppt({ id: "b", order_number: "PO-NOPE" }),
      ],
      [makeTally({ windows_if: 2 })]
    );
    // 4 real points + 6 estimated, and the day is marked part-estimate.
    expect(row.days[0].dayClass).toBe("estimated");
    expect(row.days[0].points).toBe(10);
    expect(row.capacity).toBe(12);
  });

  it("an appointment with no order number is a legacy deal too", () => {
    const row = run([makeAppt({ id: "a", order_number: null })], []);
    expect(row.days[0].dayClass).toBe("estimated");
    expect(row.legacyJobs).toHaveLength(1);
  });

  it("a legacy rate of zero scores legacy deals as no work", () => {
    const row = computeUtilization({
      crews: [makeCrew({ id: "lead", name: "Sam" })],
      dates: ["2026-10-05"],
      appointments: [makeAppt({ id: "a", order_number: "PO-NOPE" })],
      tallyByOrder: new Map(),
      weights,
      settings: { ...SETTINGS, legacy_points_per_day: 0 },
      isOff: neverOff,
    })[0];
    expect(row.days[0].points).toBe(0);
    expect(row.days[0].dayClass).toBe("estimated");
    expect(row.utilizationPct).toBe(0);
  });

  it("two installs on one day add up", () => {
    const row = run(
      [
        makeAppt({ id: "a", order_number: "PO-1" }),
        makeAppt({ id: "b", order_number: "PO-2" }),
      ],
      [
        makeTally({ order_number: "PO-1", windows_if: 3 }),
        makeTally({ order_number: "PO-2", entry_doors: 1 }),
      ]
    );
    expect(row.days[0].points).toBe(12);
    expect(row.utilizationPct).toBe(100);
  });

  it("ignores cancelled and unscheduled tiles", () => {
    const row = run(
      [
        makeAppt({ id: "a", status: "cancelled" }),
        makeAppt({ id: "b", status: "unscheduled", scheduled_date: null }),
      ],
      [makeTally({ windows_if: 6 })]
    );
    expect(row.days[0].dayClass).toBe("idle");
  });

  it("counts completed work", () => {
    const row = run([makeAppt({ id: "a", status: "complete" })], [makeTally({ windows_if: 6 })]);
    expect(row.days[0].dayClass).toBe("measurable");
    expect(row.utilizationPct).toBe(100);
  });
});

describe("computeUtilization — multi-day jobs", () => {
  const crew = makeCrew({ id: "lead", name: "Sam" });

  it("spreads load evenly across the span instead of spiking day one", () => {
    const rows = computeUtilization({
      crews: [crew],
      dates: ["2026-10-05", "2026-10-06", "2026-10-07"],
      appointments: [makeAppt({ id: "a", duration_days: 3 })],
      // 18 inserts = 36 points over 3 days = 12/day.
      tallyByOrder: new Map([["PO-1", makeTally({ windows_if: 18 })]]),
      weights,
      settings: SETTINGS,
      isOff: neverOff,
    });
    const row = rows[0];
    expect(row.days.map((d) => d.points)).toEqual([12, 12, 12]);
    expect(row.utilizationPct).toBe(100);
    expect(row.measurableDays).toBe(3);
  });

  it("flags a spanning job once, not once per day", () => {
    const rows = computeUtilization({
      crews: [crew],
      dates: ["2026-10-05", "2026-10-06", "2026-10-07"],
      appointments: [makeAppt({ id: "a", duration_days: 3, order_number: "PO-NOPE" })],
      tallyByOrder: new Map(),
      weights,
      settings: SETTINGS,
      isOff: neverOff,
    });
    expect(rows[0].estimatedDays).toBe(3);
    expect(rows[0].legacyJobs).toHaveLength(1);
  });

  it("counts a span that started before the range", () => {
    // The job began Oct 3; the range opens Oct 5. Its last two days still land
    // on this installer and must not vanish from the grid.
    const rows = computeUtilization({
      crews: [crew],
      dates: ["2026-10-05", "2026-10-06"],
      appointments: [makeAppt({ id: "a", scheduled_date: "2026-10-03", duration_days: 4 })],
      tallyByOrder: new Map([["PO-1", makeTally({ windows_if: 24 })]]),
      weights,
      settings: SETTINGS,
      isOff: neverOff,
    });
    // 48 points over 4 days = 12/day on both visible days.
    expect(rows[0].days.map((d) => d.points)).toEqual([12, 12]);
  });
});

describe("computeUtilization — attribution", () => {
  it("credits the lead AND the helper, without splitting the day", () => {
    // Both people spend the day on the job, so both are fully occupied. This
    // double-counts points across the company on purpose: the number is per
    // person occupancy, not company throughput.
    const lead = makeCrew({ id: "lead", name: "Sam" });
    const helper = makeCrew({ id: "helper", name: "Pat", crew_type: "second" });
    const rows = computeUtilization({
      crews: [lead, helper],
      dates: ["2026-10-05"],
      appointments: [makeAppt({ id: "a", crew_id: "lead", secondary_crew_id: "helper" })],
      tallyByOrder: new Map([["PO-1", makeTally({ windows_if: 6 })]]),
      weights,
      settings: SETTINGS,
      isOff: neverOff,
    });
    expect(rows[0].totalPoints).toBe(12);
    expect(rows[1].totalPoints).toBe(12);
    expect(rows[1].days[0].dayClass).toBe("measurable");
  });

  it("honors a per-installer target override", () => {
    const crew = makeCrew({ id: "lead", name: "Sam" });
    const rows = computeUtilization({
      crews: [crew],
      dates: ["2026-10-05"],
      appointments: [makeAppt({ id: "a" })],
      tallyByOrder: new Map([["PO-1", makeTally({ windows_if: 3 })]]),
      weights,
      settings: SETTINGS,
      targets: new Map([["lead", 6]]),
      isOff: neverOff,
    });
    // 6 points against a 6-point target, not the company 12.
    expect(rows[0].utilizationPct).toBe(100);
  });
});

// ─── Presentation ───────────────────────────────────────────────────────────

describe("utilizationBand", () => {
  it("maps each range to its band", () => {
    expect(utilizationBand(null, 85)).toBe("none");
    expect(utilizationBand(0, 85)).toBe("low");
    expect(utilizationBand(69.9, 85)).toBe("low");
    expect(utilizationBand(70, 85)).toBe("warn");
    expect(utilizationBand(84.9, 85)).toBe("warn");
    expect(utilizationBand(85, 85)).toBe("good");
    expect(utilizationBand(110, 85)).toBe("good");
    expect(utilizationBand(110.1, 85)).toBe("over");
  });

  it("stays ordered when the goal is set below the red cutoff", () => {
    expect(utilizationBand(50, 60)).toBe("low");
    expect(utilizationBand(65, 60)).toBe("good");
  });

  it("treats NaN as no data rather than as zero", () => {
    expect(utilizationBand(NaN, 85)).toBe("none");
  });
});

describe("sortByUtilization", () => {
  it("puts the under-utilized first and no-data last", () => {
    const mk = (name: string, pct: number | null) =>
      ({
        crew: makeCrew({ id: name, name }),
        utilizationPct: pct,
      }) as ReturnType<typeof computeUtilization>[number];

    const sorted = sortByUtilization([mk("Full", 100), mk("NoData", null), mk("Light", 40)]);
    expect(sorted.map((r) => r.crew.name)).toEqual(["Light", "Full", "NoData"]);
  });
});

describe("summarizeCoverage", () => {
  it("counts measured and legacy install jobs, ignoring service", () => {
    const crew = makeCrew({ id: "lead", name: "Sam" });
    const rows = computeUtilization({
      crews: [crew],
      dates: ["2026-10-05", "2026-10-06"],
      appointments: [
        makeAppt({ id: "ok", order_number: "PO-1" }),
        makeAppt({ id: "bad", scheduled_date: "2026-10-06", order_number: "PO-NOPE" }),
        makeAppt({
          id: "svc",
          scheduled_date: "2026-10-06",
          appointment_type: "service",
          order_number: null,
        }),
      ],
      tallyByOrder: new Map([["PO-1", makeTally({ windows_if: 6 })]]),
      weights,
      settings: SETTINGS,
      isOff: neverOff,
    });
    expect(summarizeCoverage(rows)).toEqual({
      measuredJobs: 1,
      legacyJobs: 1,
      estimatedDays: 1,
    });
  });
});

describe("formatPoints", () => {
  it("trims trailing zeros but keeps a real fraction", () => {
    expect(formatPoints(12)).toBe("12");
    expect(formatPoints(7.5)).toBe("7.5");
    expect(formatPoints(7.46)).toBe("7.5");
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(NaN)).toBe("0");
  });
});

describe("isInstallerCrew", () => {
  it("accepts in-house and sub leads", () => {
    expect(isInstallerCrew(makeCrew({ id: "a", name: "A", crew_type: "install_in_house" }))).toBe(true);
    expect(isInstallerCrew(makeCrew({ id: "b", name: "B", crew_type: "install_sub" }))).toBe(true);
  });

  it("rejects other departments and inactive rows", () => {
    expect(isInstallerCrew(makeCrew({ id: "c", name: "C", crew_type: "measure_tech" }))).toBe(false);
    expect(
      isInstallerCrew(makeCrew({ id: "d", name: "D", crew_type: "install_in_house", is_active: false }))
    ).toBe(false);
  });

  it("accepts a multi-department resource qualified to install", () => {
    expect(
      isInstallerCrew(
        makeCrew({ id: "e", name: "E", crew_type: "svc", additional_types: ["install_in_house"] })
      )
    ).toBe(true);
  });
});

describe("multi-day jobs that span a non-working day", () => {
  const crew = makeCrew({ id: "lead", name: "Sam" });
  // Fri Oct 9 2026 start, 3 days -> Fri, Sat, Sun. 18 inserts = 36 points.
  const appointments = [
    makeAppt({ id: "a", scheduled_date: "2026-10-09", duration_days: 3 }),
  ];
  const tallyByOrder = new Map([["PO-1", makeTally({ windows_if: 18 })]]);
  const dates = ["2026-10-09", "2026-10-10", "2026-10-11"];
  const weekendOff = (_c: string, d: string): string | null =>
    d === "2026-10-10" || d === "2026-10-11" ? "Weekend" : null;

  function run(isOff: (c: string, d: string) => string | null) {
    return computeUtilization({
      crews: [crew], dates, appointments, tallyByOrder,
      weights, settings: SETTINGS, isOff,
    })[0];
  }

  it("does not silently discard the weekend share of the job", () => {
    // Regression: the span is CALENDAR days, so dividing by 3 and then zeroing
    // Sat/Sun scored this 3-day job as 12 of 36 points. The installer read as a
    // third as busy as they actually were.
    expect(run(weekendOff).totalPoints).toBe(36);
  });

  it("divides the load over the days actually worked, not the raw span", () => {
    const row = run(weekendOff);
    // Only Friday is workable, so the whole job lands there — and reads as
    // overloaded, which is the honest signal that the span crosses a weekend.
    expect(row.days.map((d) => d.points)).toEqual([36, 0, 0]);
    expect(row.days.map((d) => d.dayClass)).toEqual(["measurable", "off", "off"]);
    expect(row.days[0].jobs[0].workedDays).toBe(1);
  });

  it("still spreads evenly when every day of the span is workable", () => {
    const row = run(() => null);
    expect(row.days.map((d) => d.points)).toEqual([12, 12, 12]);
    expect(row.days[0].jobs[0].workedDays).toBe(3);
  });

  it("counts the work when the job is booked over a fully blocked span", () => {
    // The scheduler can deliberately book across blocked days
    // (allow_availability_conflict). The work is real either way.
    const row = run(() => "PTO");
    expect(row.totalPoints).toBe(36);
    expect(row.days.map((d) => d.points)).toEqual([12, 12, 12]);
    expect(row.days.every((d) => d.dayClass === "measurable")).toBe(true);
  });

  it("leaves a genuinely empty off day alone", () => {
    const row = computeUtilization({
      crews: [crew], dates: ["2026-10-10"], appointments: [], tallyByOrder,
      weights, settings: SETTINGS, isOff: weekendOff,
    })[0];
    expect(row.days[0].dayClass).toBe("off");
    expect(row.capacity).toBe(0);
  });
});

describe("a material list with nothing countable on it", () => {
  const crew = makeCrew({ id: "lead", name: "Sam" });

  function run(tallies: InstallTally[]) {
    return computeUtilization({
      crews: [crew],
      dates: ["2026-10-05"],
      appointments: [makeAppt({ id: "a", order_number: "PO-1" })],
      tallyByOrder: new Map(tallies.map((t) => [t.order_number!, t])),
      weights,
      settings: SETTINGS,
      isOff: neverOff,
    })[0];
  }

  it("is estimated, not read as a confident zero", () => {
    // Seen in production: one job whose doc holds a single unit that is misc
    // or carries no abbrev, so the tally sums to zero. Scored as a real 0 it
    // was indistinguishable from an idle day, and nothing flagged it.
    const row = run([makeTally({ order_number: "PO-1" })]);
    expect(row.days[0].dayClass).toBe("estimated");
    expect(row.days[0].points).toBe(6);
    expect(row.legacyJobs).toHaveLength(1);
  });

  it("is told apart from a job that has no list at all", () => {
    const empty = run([makeTally({ order_number: "PO-1" })]).days[0].jobs[0];
    expect(empty.emptyTally).toBe(true);

    const missing = run([]).days[0].jobs[0];
    expect(missing.emptyTally).toBe(false);
    // Both are estimated; only the cause differs.
    expect(empty.estimated && missing.estimated).toBe(true);
  });

  it("still counts a list that has real units on it", () => {
    const row = run([makeTally({ order_number: "PO-1", windows_if: 6 })]);
    expect(row.days[0].dayClass).toBe("measurable");
    expect(row.days[0].points).toBe(12);
    expect(row.legacyJobs).toHaveLength(0);
  });
});

describe("helper crews", () => {
  const lead = makeCrew({ id: "lead", name: "Sam" });
  const helper = makeCrew({ id: "helper", name: "Morgan" });

  // Seen in production: a 5-day job led by Sam with Morgan as the second crew.
  // Morgan's whole week read 0 and went red while he was on site all week.
  const fiveDay = makeAppt({
    id: "a",
    crew_id: "lead",
    secondary_crew_id: "helper",
    scheduled_date: "2026-10-05",
    duration_days: 5,
  });
  const dates = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];

  function run(appt = fiveDay) {
    return computeUtilization({
      crews: [lead, helper],
      dates,
      appointments: [appt],
      // 30 inserts = 60 points over 5 days = 12/day.
      tallyByOrder: new Map([["PO-1", makeTally({ windows_if: 30 })]]),
      weights,
      settings: SETTINGS,
      isOff: neverOff,
    });
  }

  it("credits the helper for the days they are on the job", () => {
    const [sam, morgan] = run();
    expect(morgan.days.map((d) => d.points)).toEqual([12, 12, 12, 12, 12]);
    expect(morgan.utilizationPct).toBe(100);
    expect(morgan.idleDays).toBe(0);
    // The lead is unaffected — the day is not split between them, because both
    // people are fully occupied by it.
    expect(sam.utilizationPct).toBe(100);
  });

  it("marks who is leading and who is helping", () => {
    const [sam, morgan] = run();
    expect(sam.days[0].jobs[0].role).toBe("lead");
    expect(morgan.days[0].jobs[0].role).toBe("helper");
  });

  it("honours partial helper days", () => {
    const [, morgan] = run({ ...fiveDay, secondary_day_offsets: [1, 2] });
    // On site days 2 and 3 only, at the job's normal daily intensity.
    expect(morgan.days.map((d) => d.points)).toEqual([0, 12, 12, 0, 0]);
    expect(morgan.idleDays).toBe(3);
  });

  it("does not double-credit a crew listed twice on one job", () => {
    const [sam] = run({ ...fiveDay, secondary_crew_id: "lead" });
    expect(sam.days[0].points).toBe(12);
  });
});

describe("legacy deals estimated from the rForce unit count", () => {
  const crew = makeCrew({ id: "lead", name: "Sam" });
  const withUnits = { ...SETTINGS, legacy_points_per_unit: 2.8 };

  function run(
    appt: Partial<Appointment>,
    units: Map<string, number>,
    settings = withUnits,
    days = 1
  ) {
    const dates = Array.from({ length: days }, (_, i) =>
      `2026-10-${String(5 + i).padStart(2, "0")}`
    );
    return computeUtilization({
      crews: [crew],
      dates,
      appointments: [makeAppt({ id: "a", order_number: "PO-NOPE", ...appt })],
      tallyByOrder: new Map(),
      rforceUnitsByWo: units,
      weights,
      settings,
      isOff: neverOff,
    })[0];
  }

  it("uses work_orders.total_units, NOT appointments.product_count", () => {
    // Order 04761892 in production: product_count 92 against total_units 23
    // (14 windows + 9 doors). product_count counts line items, so estimating
    // from it inflated the job fourfold and read 430% of a 5-day week.
    const row = run(
      { work_order_number: "WO-1", product_count: 92, duration_days: 5 },
      new Map([["WO-1", 23]]),
      withUnits,
      5
    );
    expect(row.days[0].jobs[0].units).toBe(23);
    expect(row.days[0].jobs[0].jobPoints).toBeCloseTo(64.4, 1);
    expect(row.days[0].jobs[0].estimateBasis).toBe("units");
    // ~107% of a full day, not 430%.
    expect(row.days[0].points).toBeCloseTo(12.88, 1);
  });

  it("falls back to the per-day rate when rForce has no unit count", () => {
    const row = run(
      { work_order_number: "WO-1", product_count: 92, duration_days: 3 },
      new Map(),
      withUnits,
      3
    );
    expect(row.days[0].jobs[0].estimateBasis).toBe("days");
    expect(row.days[0].jobs[0].jobPoints).toBe(18);
    expect(row.days[0].points).toBe(6);
  });

  it("ignores product_count entirely", () => {
    const row = run({ work_order_number: null, product_count: 999 }, new Map());
    expect(row.days[0].jobs[0].units).toBe(0);
    expect(row.days[0].jobs[0].estimateBasis).toBe("days");
    expect(row.days[0].points).toBe(6);
  });

  it("a per-unit rate of zero disables unit estimates entirely", () => {
    const row = run(
      { work_order_number: "WO-1" },
      new Map([["WO-1", 23]]),
      { ...SETTINGS, legacy_points_per_unit: 0 }
    );
    expect(row.days[0].jobs[0].estimateBasis).toBe("days");
    expect(row.days[0].points).toBe(6);
  });

  it("never applies to a job that HAS a material list", () => {
    const row = computeUtilization({
      crews: [crew],
      dates: ["2026-10-05"],
      appointments: [
        makeAppt({ id: "a", order_number: "PO-1", work_order_number: "WO-1" }),
      ],
      tallyByOrder: new Map([["PO-1", makeTally({ order_number: "PO-1", windows_if: 6 })]]),
      rforceUnitsByWo: new Map([["WO-1", 23]]),
      weights,
      settings: withUnits,
      isOff: neverOff,
    })[0];
    expect(row.days[0].points).toBe(12);
    expect(row.days[0].jobs[0].estimated).toBe(false);
    expect(row.days[0].jobs[0].estimateBasis).toBeNull();
  });
});

describe("summarizeOpenDays", () => {
  const a = makeCrew({ id: "a", name: "Wide Open" });
  const b = makeCrew({ id: "b", name: "One Gap" });
  const c = makeCrew({ id: "c", name: "Booked Solid" });
  const dates = ["2026-10-05", "2026-10-06", "2026-10-07"];

  const rows = computeUtilization({
    crews: [a, b, c],
    dates,
    appointments: [
      // b works one day, c works all three
      makeAppt({ id: "b1", crew_id: "b", order_number: "PO-1", scheduled_date: "2026-10-05" }),
      makeAppt({ id: "c1", crew_id: "c", order_number: "PO-1", scheduled_date: "2026-10-05", duration_days: 3 }),
    ],
    tallyByOrder: new Map([["PO-1", makeTally({ order_number: "PO-1", windows_if: 6 })]]),
    weights,
    settings: SETTINGS,
    isOff: neverOff,
  });

  it("lists who has room, emptiest first, with the soonest open day", () => {
    const open = summarizeOpenDays(rows, dates);
    expect(open.map((e) => [e.crew.name, e.openDays, e.nextOpen])).toEqual([
      ["Wide Open", 3, "2026-10-05"],
      ["One Gap", 2, "2026-10-06"],
    ]);
  });

  it("leaves out anyone with no open day", () => {
    expect(summarizeOpenDays(rows, dates).map((e) => e.crew.name)).not.toContain("Booked Solid");
  });

  it("only looks inside the window it is given", () => {
    expect(summarizeOpenDays(rows, ["2026-10-05"]).map((e) => e.crew.name)).toEqual(["Wide Open"]);
  });
});
