"use client";

import { format, parseISO } from "date-fns";
import { AlertTriangle, X } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { crewColorFor } from "@/lib/preferences";
import { typeLabel } from "@/lib/calendar-utils";
import { formatPoints, type CrewDay, type CrewUtilization } from "@/lib/utilization";

/**
 * What landed on one installer on one day, and what it was worth.
 *
 * Exists so a number in the grid is never unexplained: every point is traceable
 * to a job and a product mix, and a hatched cell names the order whose material
 * list is missing so somebody can go build it.
 */

interface Props {
  row: CrewUtilization;
  day: CrewDay;
  onClose: () => void;
}

export default function UtilizationDayDetail({ row, day, onClose }: Props) {
  useEscapeKey(onClose);

  const date = parseISO(day.date);
  const installJobs = day.jobs.filter((j) => j.loadBearing);
  const otherJobs = day.jobs.filter((j) => !j.loadBearing);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative bg-background rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto animate-slide-up safe-area-bottom">
        <header className="sticky top-0 bg-background border-b border-border px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: crewColorFor(row.crew) }}
                aria-hidden
              />
              <span className="truncate">{row.crew.name}</span>
            </h2>
            <p className="text-sm text-muted mt-0.5">{format(date, "EEEE, MMMM d, yyyy")}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 -m-1 text-muted hover:text-foreground shrink-0"
          >
            <X size={20} />
          </button>
        </header>

        <div className="px-4 py-3 space-y-4">
          {/* ── The day's verdict ── */}
          {day.dayClass === "off" ? (
            <p className="text-sm">
              Off — <span className="text-muted">{day.offReason}</span>. Carries no capacity, so
              it is left out of the utilization ratio entirely.
            </p>
          ) : day.dayClass === "estimated" ? (
            <div
              className="rounded-lg px-3 py-2.5 text-sm"
              style={{
                backgroundColor: "color-mix(in srgb, var(--warning) var(--blk-tint), var(--background))",
              }}
            >
              <p className="font-medium flex items-center gap-1.5">
                <AlertTriangle size={14} />
                {formatPoints(day.points)} of {formatPoints(day.capacity)} points — part estimated
              </p>
              <p className="text-muted mt-1">
                A legacy deal on this day has no material list, so its share is estimated from
                how many days it runs rather than counted from products. The job count below is
                deals, not units.
              </p>
            </div>
          ) : day.dayClass === "idle" ? (
            <p className="text-sm">
              Nothing booked. Counted as{" "}
              <strong>0 of {formatPoints(day.capacity)} points</strong> — an open day.
            </p>
          ) : day.dayClass === "non_install" ? (
            <p className="text-sm">
              Non-install work only. The day is counted at{" "}
              <strong>0 of {formatPoints(day.capacity)} points</strong> because there is no
              product list behind it, but it did consume the day.
            </p>
          ) : (
            <p className="text-sm">
              <strong className="text-base">
                {formatPoints(day.points)} of {formatPoints(day.capacity)} points
              </strong>{" "}
              <span className="text-muted">
                ({Math.round((day.points / day.capacity) * 100)}% of a full day)
              </span>
            </p>
          )}

          {/* ── Install jobs, with the point math shown ── */}
          {installJobs.length > 0 && (
            <section>
              <h3 className="text-xs uppercase tracking-wide text-muted mb-2">
                Install {installJobs.length > 1 ? `(${installJobs.length})` : ""}
              </h3>
              <ul className="space-y-2.5">
                {installJobs.map((job) => (
                  <li
                    key={job.appointmentId}
                    className="border border-border rounded-lg px-3 py-2.5"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium truncate">{job.customerName}</span>
                      {job.hasTally && (
                        <span className="text-sm tabular-nums shrink-0">
                          {formatPoints(job.dayPoints)} pts
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-muted mt-0.5">
                      {job.orderNumber ? `Order ${job.orderNumber}` : "No order number"}
                      {job.workOrderNumber ? ` · WO ${job.workOrderNumber}` : ""}
                      {job.spanDays > 1 ? ` · ${job.spanDays}-day job` : ""}
                    </p>

                    {job.estimated ? (
                      <div className="mt-1.5" style={{ color: "var(--warning)" }}>
                        <p className="text-xs flex items-center gap-1.5">
                          <AlertTriangle size={12} />
                          {job.emptyTally
                            ? "Material list has no countable units"
                            : "Legacy deal — no material list"}
                        </p>
                        <p className="text-[11px] text-muted mt-1">
                          {job.estimateBasis === "units" ? (
                            <>
                              Estimated from {job.units} rForce units ={" "}
                              {formatPoints(job.jobPoints)} pts
                              {job.spanDays > 1 ? ` over ${job.workedDays}d` : ""}. The frame
                              mix is unknown, so this is an average, not a product count.
                            </>
                          ) : (
                            <>
                              Estimated at{" "}
                              {formatPoints(job.jobPoints / Math.max(1, job.spanDays))} pts per
                              day it runs
                              {job.spanDays > 1
                                ? ` × ${job.spanDays} days = ${formatPoints(job.jobPoints)} pts`
                                : ""}
                              . No unit count on this job, so not a product count either.
                            </>
                          )}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {job.breakdown.map((b) => (
                            <span
                              key={`${b.product}|${b.frame}`}
                              title={`${b.count} × ${b.label} = ${formatPoints(b.points)} pts`}
                              className="text-[11px] px-1.5 py-0.5 rounded bg-surface border border-border tabular-nums"
                            >
                              {b.count} {b.short}
                            </span>
                          ))}
                        </div>
                        {job.spanDays > 1 && (
                          <p className="text-[11px] text-muted mt-1.5">
                            {formatPoints(job.jobPoints)} pts over {job.workedDays} worked{" "}
                            {job.workedDays === 1 ? "day" : "days"} ={" "}
                            {formatPoints(job.dayPoints)}/day
                            {job.workedDays < job.spanDays && (
                              <>
                                {" "}
                                <span title="The span crosses days this crew does not work, so the load divides over the worked days only.">
                                  ({job.spanDays}-day span, {job.spanDays - job.workedDays} not
                                  worked)
                                </span>
                              </>
                            )}
                          </p>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Everything else on the day ── */}
          {otherJobs.length > 0 && (
            <section>
              <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Other work</h3>
              <ul className="space-y-1.5">
                {otherJobs.map((job) => (
                  <li key={job.appointmentId} className="text-sm flex justify-between gap-3">
                    <span className="truncate">{job.customerName}</span>
                    <span className="text-xs text-muted shrink-0">
                      {typeLabel(job.appointmentType)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted mt-2">
                Consumes the day but carries no product load — there is no material list behind
                service, JIP or LSWP work.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
