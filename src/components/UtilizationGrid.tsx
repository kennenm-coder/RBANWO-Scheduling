"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Wrench } from "lucide-react";
import { crewColorFor } from "@/lib/preferences";
import {
  describeDayPoints,
  formatPoints,
  utilizationBand,
  type CrewDay,
  type CrewUtilization,
  type DayClass,
  type UtilBand,
} from "@/lib/utilization";

/**
 * The per-day utilization grid — installers down, days across.
 *
 * Each cell is a bar filled to how much of that day is booked, labelled with a
 * percentage. Points are the engine, not the interface: nobody schedules in
 * points, and "8.7" meant nothing without mental arithmetic against a 12-point
 * day. The exact points live in the hover and the drill-down.
 *
 * Band accents reuse the theme's own semantic tokens and are tinted with the
 * same color-mix-against-background recipe as blocked-visuals.ts, which keeps
 * one definition legible on white, near-black and ivory alike.
 */

const BAND_ACCENT: Record<UtilBand, string> = {
  low: "var(--danger)",
  warn: "var(--warning)",
  good: "var(--success)",
  over: "var(--primary)",
  none: "var(--muted)",
};

function tint(accent: string, strength = "var(--blk-tint)"): string {
  return `color-mix(in srgb, ${accent} ${strength}, var(--background))`;
}

/** A day's own band, measured against its capacity rather than the range. */
function dayBand(day: CrewDay, goalPct: number): UtilBand {
  if (day.capacity <= 0) return "none";
  // Service / JIP / LSWP days score no product by design, but a red cell reads
  // as "did nothing" for a day spent out on a call. Neutral, not an accusation.
  if (day.dayClass === "non_install") return "none";
  return utilizationBand((day.points / day.capacity) * 100, goalPct);
}

const CLASS_NOTE: Record<DayClass, string> = {
  measurable: "",
  estimated: "Includes a legacy deal — estimated",
  idle: "Nothing booked",
  non_install: "Service / JIP — no product",
  off: "Off",
};

interface Props {
  rows: CrewUtilization[];
  /** The days to draw. May be a slice of the full range. */
  dates: string[];
  goalPct: number;
  /** Show the range rollup column. Off for the secondary weeks grid. */
  showRange?: boolean;
  onSelectDay: (row: CrewUtilization, day: CrewDay) => void;
}

export default function UtilizationGrid({
  rows,
  dates,
  goalPct,
  showRange = true,
  onSelectDay,
}: Props) {
  // A heavier divider where each Monday starts, so a multi-week grid reads as
  // weeks rather than one undifferentiated run of columns.
  const weekStartIndexes = useMemo(() => {
    const set = new Set<number>();
    dates.forEach((d, i) => {
      if (i > 0 && parseISO(d).getDay() === 1) set.add(i);
    });
    return set;
  }, [dates]);

  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted">
        No active install resources to report on.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0 text-sm w-full">
        <thead>
          <tr>
            <th
              className="sticky left-0 z-20 bg-surface border-b border-r border-border px-3 py-2 text-left font-medium text-muted min-w-[6.5rem] sm:min-w-[9rem]"
              scope="col"
            >
              Installer
            </th>
            {dates.map((d, i) => {
              const date = parseISO(d);
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <th
                  key={d}
                  scope="col"
                  className={`border-b border-border px-1 py-2 text-center font-medium min-w-[3rem] ${
                    weekend ? "text-muted/60" : "text-muted"
                  } ${weekStartIndexes.has(i) ? "border-l-2 border-l-border" : ""}`}
                >
                  <div className="text-[10px] uppercase leading-tight">{format(date, "EEE")}</div>
                  <div className="text-xs leading-tight">{format(date, "M/d")}</div>
                </th>
              );
            })}
            {showRange && (
              <th
                scope="col"
                className="sticky right-0 z-20 bg-surface border-b border-l border-border px-3 py-2 text-right font-medium text-muted min-w-[5.5rem] sm:min-w-[7rem]"
              >
                Range
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowBand = utilizationBand(row.utilizationPct, goalPct);
            // Days are looked up by date so this grid can draw any slice of the
            // range without the caller re-slicing every row.
            const byDate = new Map(row.days.map((d) => [d.date, d]));

            return (
              <tr key={row.crew.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-background border-b border-r border-border px-3 py-1.5 text-left font-normal"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: crewColorFor(row.crew) }}
                      aria-hidden
                    />
                    <span className="truncate max-w-[4.5rem] sm:max-w-[7rem]" title={row.crew.name}>
                      {row.crew.name}
                    </span>
                    {row.crew.crew_type === "install_sub" && (
                      <span className="text-[10px] text-muted shrink-0">sub</span>
                    )}
                  </span>
                </th>

                {dates.map((date, i) => {
                  const day = byDate.get(date);
                  if (!day) return <td key={date} className="border-b border-border" />;

                  const band = dayBand(day, goalPct);
                  const accent = BAND_ACCENT[band];
                  const jobCount = day.jobs.length;
                  const pct = day.capacity > 0 ? (day.points / day.capacity) * 100 : 0;
                  // The bar caps at full; the number keeps telling the truth,
                  // so 275% reads as a brim-full blue cell labelled 275%.
                  const fill = Math.max(0, Math.min(100, pct));

                  const header = `${row.crew.name} — ${format(parseISO(day.date), "EEE MMM d")}`;
                  const hover = `${header}\n${"—".repeat(header.length)}\n${describeDayPoints(day)}`;
                  const aria =
                    day.capacity > 0
                      ? `${header}, ${Math.round(pct)} percent of a full day from ${jobCount} job${jobCount === 1 ? "" : "s"}${day.dayClass === "estimated" ? ", partly estimated" : ""}`
                      : `${header}, ${CLASS_NOTE[day.dayClass]}`;

                  return (
                    <td
                      key={date}
                      className={`border-b border-border p-0 ${
                        weekStartIndexes.has(i) ? "border-l-2 border-l-border" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectDay(row, day)}
                        title={hover}
                        aria-label={aria}
                        className="relative w-full h-10 flex items-center justify-center overflow-hidden transition-opacity hover:opacity-80 focus:outline-2 focus:outline-offset-[-2px] focus:outline-primary"
                        style={{
                          backgroundColor:
                            day.dayClass === "off" ? "var(--surface)" : "var(--background)",
                          // Amber underline marks a number that is part
                          // estimate, so it can never read as counted.
                          ...(day.dayClass === "estimated"
                            ? { boxShadow: "inset 0 -3px 0 0 var(--warning)" }
                            : null),
                        }}
                      >
                        {day.dayClass !== "off" && day.capacity > 0 && fill > 0 && (
                          <span
                            aria-hidden
                            className="absolute left-0 bottom-0 top-0"
                            style={{ width: `${fill}%`, backgroundColor: tint(accent, "45%") }}
                          />
                        )}

                        {day.dayClass === "off" ? (
                          <span className="text-[10px] text-muted">—</span>
                        ) : day.dayClass === "non_install" ? (
                          <Wrench size={12} className="relative" style={{ color: "var(--muted)" }} />
                        ) : (
                          <span className="relative flex items-baseline gap-0.5">
                            <span className="text-xs font-semibold tabular-nums">
                              {Math.round(pct)}
                              <span className="text-[9px] font-normal">%</span>
                            </span>
                            {jobCount > 1 && (
                              <span className="text-[9px] text-muted leading-none">·{jobCount}</span>
                            )}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}

                {showRange && (
                  <td className="sticky right-0 z-10 bg-background border-b border-l border-border px-3 py-1.5 text-right">
                    {row.utilizationPct === null ? (
                      <span className="text-xs text-muted">no data</span>
                    ) : (
                      <span className="flex flex-col items-end gap-0.5">
                        <span
                          className="text-sm font-semibold tabular-nums"
                          style={{ color: BAND_ACCENT[rowBand] }}
                        >
                          {Math.round(row.utilizationPct)}%
                        </span>
                        <span className="text-[10px] text-muted tabular-nums">
                          {formatPoints(row.totalPoints)}/{formatPoints(row.capacity)} pts
                        </span>
                        {(row.estimatedDays > 0 || row.idleDays > 0) && (
                          <span className="flex flex-wrap justify-end gap-1 text-[10px] text-muted">
                            {row.idleDays > 0 && <span>{row.idleDays} open</span>}
                            {row.estimatedDays > 0 && (
                              <span style={{ color: "var(--warning)" }}>
                                {row.estimatedDays} est.
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Shared legend, rendered by the page under the grid. */
export function UtilizationLegend({ goalPct }: { goalPct: number }) {
  const items: { band: UtilBand; label: string }[] = [
    { band: "low", label: "under 70% of a day" },
    { band: "warn", label: `70–${goalPct}%` },
    { band: "good", label: `${goalPct}%+` },
    { band: "over", label: "over 110%" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-xs text-muted">
      {items.map(({ band, label }) => (
        <span key={band} className="flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-sm border border-border"
            style={{ backgroundColor: tint(BAND_ACCENT[band], "45%") }}
            aria-hidden
          />
          {label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span
          className="w-3 h-3 rounded-sm border border-border"
          style={{ boxShadow: "inset 0 -3px 0 0 var(--warning)" }}
          aria-hidden
        />
        estimated — legacy deal, no material list
      </span>
      <span className="flex items-center gap-1.5">
        <Wrench size={12} />
        service / JIP — no product load
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="w-3 h-3 rounded-sm border border-border"
          style={{ backgroundColor: "var(--surface)" }}
          aria-hidden
        />
        off — weekend, PTO, holiday
      </span>
      <span>·n = jobs that day</span>
    </div>
  );
}
