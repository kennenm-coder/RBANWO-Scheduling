"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Wrench } from "lucide-react";
import { crewColorFor } from "@/lib/preferences";
import {
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
 * The primary view, not a rollup: a light Tuesday is the thing a scheduling
 * manager acts on, and a range total would average it away. The range rollup
 * sits in the sticky summary column at the right.
 *
 * Band accents reuse the theme's own semantic tokens (danger / warning /
 * success / primary) and are tinted with the same color-mix-against-background
 * recipe as blocked-visuals.ts, which is what keeps one definition legible on
 * white, near-black and ivory alike.
 */

const BAND_ACCENT: Record<UtilBand, string> = {
  low: "var(--danger)",
  warn: "var(--warning)",
  good: "var(--success)",
  over: "var(--primary)",
  none: "var(--muted)",
};

function tint(accent: string): string {
  return `color-mix(in srgb, ${accent} var(--blk-tint), var(--background))`;
}

/** A day's own band, measured against its capacity rather than the range. */
function dayBand(day: CrewDay, goalPct: number): UtilBand {
  if (day.capacity <= 0) return "none";
  return utilizationBand((day.points / day.capacity) * 100, goalPct);
}

const CLASS_NOTE: Record<DayClass, string> = {
  measurable: "",
  idle: "Nothing booked",
  non_install: "Service / JIP — no product",
  unmeasured: "No material list — excluded",
  off: "Off",
};

interface Props {
  rows: CrewUtilization[];
  dates: string[];
  goalPct: number;
  onSelectDay: (row: CrewUtilization, day: CrewDay) => void;
}

export default function UtilizationGrid({ rows, dates, goalPct, onSelectDay }: Props) {
  // Week boundaries so a 4-week range stays readable: a heavier divider where
  // each Monday starts, instead of twenty identical columns.
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
      <table className="border-separate border-spacing-0 text-sm">
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
                  className={`border-b border-border px-1 py-2 text-center font-medium min-w-[2.75rem] sm:min-w-[3.25rem] ${
                    weekend ? "text-muted/60" : "text-muted"
                  } ${weekStartIndexes.has(i) ? "border-l-2 border-l-border" : ""}`}
                >
                  <div className="text-[10px] uppercase leading-tight">{format(date, "EEE")}</div>
                  <div className="text-xs leading-tight">{format(date, "M/d")}</div>
                </th>
              );
            })}
            <th
              scope="col"
              className="sticky right-0 z-20 bg-surface border-b border-l border-border px-3 py-2 text-right font-medium text-muted min-w-[5.5rem] sm:min-w-[7.5rem]"
            >
              Range
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowBand = utilizationBand(row.utilizationPct, goalPct);
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

                {row.days.map((day, i) => {
                  const band = dayBand(day, goalPct);
                  const accent = BAND_ACCENT[band];
                  const isCounted = day.capacity > 0;
                  const note = CLASS_NOTE[day.dayClass];
                  const label = `${row.crew.name}, ${format(parseISO(day.date), "EEE MMM d")} — ${
                    isCounted ? `${formatPoints(day.points)} of ${formatPoints(day.capacity)} points` : note
                  }`;

                  return (
                    <td
                      key={day.date}
                      className={`border-b border-border p-0 ${
                        weekStartIndexes.has(i) ? "border-l-2 border-l-border" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectDay(row, day)}
                        title={label}
                        aria-label={label}
                        className="w-full h-9 flex items-center justify-center text-xs tabular-nums transition-opacity hover:opacity-75 focus:outline-2 focus:outline-offset-[-2px] focus:outline-primary"
                        style={
                          day.dayClass === "off"
                            ? { backgroundColor: "var(--surface)", color: "var(--muted)" }
                            : day.dayClass === "unmeasured"
                              ? {
                                  // Hatched rather than tinted: this day is not a
                                  // low score, it is no score. Reading it as "red"
                                  // would be a lie about the installer.
                                  backgroundImage:
                                    "repeating-linear-gradient(45deg, var(--border) 0 2px, transparent 2px 6px)",
                                  color: "var(--foreground)",
                                }
                              : { backgroundColor: tint(accent), color: "var(--foreground)" }
                        }
                      >
                        {day.dayClass === "off" ? (
                          <span className="text-[10px]">—</span>
                        ) : day.dayClass === "unmeasured" ? (
                          <AlertTriangle size={12} style={{ color: "var(--warning)" }} />
                        ) : day.dayClass === "non_install" ? (
                          <Wrench size={12} style={{ color: "var(--muted)" }} />
                        ) : (
                          <span className="font-medium">{formatPoints(day.points)}</span>
                        )}
                      </button>
                    </td>
                  );
                })}

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
                    </span>
                  )}
                  {(row.unmeasuredDays > 0 || row.idleDays > 0) && (
                    <span className="mt-0.5 flex flex-wrap justify-end gap-1 text-[10px] text-muted">
                      {row.idleDays > 0 && <span>{row.idleDays} idle</span>}
                      {row.unmeasuredDays > 0 && (
                        <span style={{ color: "var(--warning)" }}>{row.unmeasuredDays} unmeasured</span>
                      )}
                    </span>
                  )}
                </td>
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
    { band: "low", label: "under 70%" },
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
            style={{ backgroundColor: tint(BAND_ACCENT[band]) }}
            aria-hidden
          />
          {label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span
          className="w-3 h-3 rounded-sm border border-border"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--border) 0 2px, transparent 2px 6px)",
          }}
          aria-hidden
        />
        no material list
      </span>
      <span className="flex items-center gap-1.5">
        <Wrench size={12} />
        service / JIP
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="w-3 h-3 rounded-sm border border-border"
          style={{ backgroundColor: "var(--surface)" }}
          aria-hidden
        />
        off
      </span>
    </div>
  );
}
