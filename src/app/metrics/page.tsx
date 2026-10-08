"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, ShieldX } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import UtilizationGrid, { UtilizationLegend } from "@/components/UtilizationGrid";
import UtilizationDayDetail from "@/components/UtilizationDayDetail";
import { canManage } from "@/lib/auth";
import {
  buildWeightMap,
  computeUtilization,
  formatPoints,
  isInstallerCrew,
  LOAD_BEARING_TYPES,
  sortByUtilization,
  summarizeCoverage,
  type CrewDay,
  type CrewUtilization,
  type InstallTally,
  type UtilizationAppointment,
} from "@/lib/utilization";
import {
  buildOffLookup,
  datesInRange,
  fetchInstallTallies,
  fetchUtilizationAppointments,
  fetchUtilizationConfig,
  type UtilizationConfig,
} from "@/lib/utilization-store";

/**
 * Installer utilization — manager and admin only.
 *
 * Opens on the next four weeks, which is far enough ahead to act on. The range
 * moves in whole weeks in either direction.
 *
 * Availability, crews and time off come from DataProvider (already loaded for
 * every route). Only the appointments, tallies and config are fetched here, so
 * opening this tab costs three small indexed reads and touches no jsonb. See
 * INSTALLER_UTILIZATION_PLAN.md.
 */

const DEFAULT_WEEKS = 4;

/** Monday of the current week — the range anchor. */
function defaultStart(): string {
  return format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export default function MetricsPage() {
  const { role, status } = useAuth();
  const {
    crews,
    availabilityRules,
    availabilityExceptions,
    calendarBlocks,
    timeOffRequests,
    loading: dataLoading,
  } = useData();

  const [startDate, setStartDate] = useState(defaultStart);
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);
  const [appointments, setAppointments] = useState<UtilizationAppointment[]>([]);
  const [tallyByOrder, setTallyByOrder] = useState<Map<string, InstallTally>>(new Map());
  const [config, setConfig] = useState<UtilizationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ row: CrewUtilization; day: CrewDay } | null>(null);

  const allowed = canManage(role);
  const endDate = useMemo(
    () => format(addDays(parseISO(startDate), weeks * 7 - 1), "yyyy-MM-dd"),
    [startDate, weeks]
  );
  const dates = useMemo(() => datesInRange(startDate, endDate), [startDate, endDate]);

  const installers = useMemo(
    () => crews.filter(isInstallerCrew).sort((a, b) => a.sort_order - b.sort_order),
    [crews]
  );
  const installerIds = useMemo(() => installers.map((c) => c.id), [installers]);
  // Depend on the joined ids, not the array: DataProvider hands back a new
  // `crews` array on every refresh, and an array identity in the dep list would
  // re-run the whole fetch each time even though the installers never changed.
  const installerKey = installerIds.join(",");

  // ── Config: fetched ONCE, not per range ──
  // Weights and targets do not change when the date range does, so refetching
  // them on every range change would be three wasted round trips per click.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetchUtilizationConfig();
        if (!cancelled) setConfig(cfg);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load utilization settings.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  // ── Appointments + tallies: the only range-dependent reads ──
  useEffect(() => {
    if (!allowed) return;
    // No installers to report on — skip the query entirely, but still clear the
    // spinner. Returning early without this left the page loading forever.
    if (!installerKey) {
      setAppointments([]);
      setTallyByOrder(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const appts = await fetchUtilizationAppointments(
          startDate,
          endDate,
          installerKey.split(",")
        );
        // Only installs carry a material list, so only their order numbers are
        // worth asking the tally table about. Including service and JIP orders
        // would pad the `in (...)` list with keys that can never match.
        const orders = appts
          .filter((a) => LOAD_BEARING_TYPES.includes(a.appointment_type))
          .map((a) => a.order_number?.trim())
          .filter((o): o is string => !!o);
        const tallies = await fetchInstallTallies(orders);
        if (cancelled) return;
        setAppointments(appts);
        setTallyByOrder(tallies);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load utilization data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, startDate, endDate, installerKey]);

  const isOff = useMemo(
    () =>
      buildOffLookup(
        installers,
        availabilityRules,
        availabilityExceptions,
        calendarBlocks || [],
        timeOffRequests
      ),
    [installers, availabilityRules, availabilityExceptions, calendarBlocks, timeOffRequests]
  );

  const rows = useMemo(() => {
    if (!config) return [];
    return sortByUtilization(
      computeUtilization({
        crews: installers,
        dates,
        appointments,
        tallyByOrder,
        weights: buildWeightMap(config.weights),
        settings: config.settings,
        targets: config.targets,
        isOff,
      })
    );
  }, [config, installers, dates, appointments, tallyByOrder, isOff]);

  const coverage = useMemo(() => summarizeCoverage(rows), [rows]);

  const shiftWeeks = useCallback((delta: number) => {
    setStartDate((d) => format(addDays(parseISO(d), delta * 7), "yyyy-MM-dd"));
  }, []);

  // ── Gates ──
  // The nav hides this tab for other roles, but hiding a link is not a gate —
  // anyone can type the URL.
  if (status === "loading" || dataLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 min-h-[60vh]">
        <div className="w-full max-w-sm text-center space-y-3">
          <ShieldX size={40} className="mx-auto text-muted" />
          <p className="font-medium">Managers only</p>
          <p className="text-sm text-muted">
            Installer utilization is limited to the Admin and Scheduling Manager roles.
          </p>
        </div>
      </div>
    );
  }

  const goalPct = config?.settings.goal_utilization_pct ?? 85;
  const target = config?.settings.target_points_per_day ?? 12;
  const noWeights = !!config && config.weights.length === 0;

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3 sticky top-0 z-30">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Utilization</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => shiftWeeks(-1)}
              aria-label="Previous week"
              className="p-1.5 rounded-md border border-border text-muted hover:text-foreground"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setStartDate(defaultStart())}
              className="px-2.5 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-surface"
            >
              Today
            </button>
            <button
              onClick={() => shiftWeeks(1)}
              aria-label="Next week"
              className="p-1.5 rounded-md border border-border text-muted hover:text-foreground"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          <span>
            {format(parseISO(startDate), "MMM d")} – {format(parseISO(endDate), "MMM d, yyyy")}
          </span>
          <span className="flex items-center gap-1">
            {[2, 4, 6].map((w) => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className={`px-1.5 py-0.5 rounded border ${
                  weeks === w
                    ? "border-primary text-primary font-medium"
                    : "border-border hover:bg-surface"
                }`}
              >
                {w}w
              </button>
            ))}
          </span>
          <span>
            Full day = <strong className="text-foreground">{formatPoints(target)} pts</strong>
          </span>
          <span>
            Goal <strong className="text-foreground">{goalPct}%</strong>
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-border px-4 py-3 text-sm">
            <p className="font-medium flex items-center gap-1.5" style={{ color: "var(--danger)" }}>
              <AlertTriangle size={14} />
              Could not load utilization
            </p>
            <p className="text-muted mt-1">{error}</p>
            <p className="text-muted mt-2 text-xs">
              If this says the tally table is missing, migration{" "}
              <code>20261008_001_installer_utilization.sql</code> has not been applied yet.
            </p>
          </div>
        ) : (
          <>
            {noWeights && (
              <div
                className="m-4 rounded-lg px-4 py-3 text-sm"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--warning) var(--blk-tint), var(--background))",
                }}
              >
                <p className="font-medium flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  No point weights configured
                </p>
                <p className="text-muted mt-1">
                  Every job scores zero until <code>sched_load_weights</code> is seeded. Re-run
                  migration 20261008_001.
                </p>
              </div>
            )}

            {/* The honesty line. Without it the numbers under-report quietly. */}
            {(coverage.missingJobs > 0 || coverage.measuredJobs > 0) && (
              <p className="px-4 pt-3 text-xs text-muted">
                {coverage.measuredJobs} install
                {coverage.measuredJobs === 1 ? "" : "s"} counted
                {coverage.missingJobs > 0 && (
                  <>
                    {" · "}
                    <span style={{ color: "var(--warning)" }}>
                      {coverage.missingJobs} excluded with no material list, across{" "}
                      {coverage.unmeasuredDays} day
                      {coverage.unmeasuredDays === 1 ? "" : "s"}
                    </span>
                  </>
                )}
              </p>
            )}

            <div className="p-4 pt-3">
              <UtilizationGrid
                rows={rows}
                dates={dates}
                goalPct={goalPct}
                onSelectDay={(row, day) => setSelected({ row, day })}
              />
            </div>

            <UtilizationLegend goalPct={goalPct} />

            {/* The nag list — turns a flagged cell into an action. */}
            {coverage.missingJobs > 0 && (
              <section className="px-4 pb-6">
                <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
                  Missing material lists
                </h2>
                <ul className="space-y-1.5">
                  {rows.flatMap((row) =>
                    row.missingTallyJobs.map((job) => (
                      <li
                        key={job.appointmentId}
                        className="text-sm flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border pb-1.5"
                      >
                        <span className="truncate">
                          {job.customerName}
                          <span className="text-muted">
                            {" — "}
                            {row.crew.name}
                          </span>
                        </span>
                        <span className="text-xs text-muted tabular-nums">
                          {job.orderNumber ? `Order ${job.orderNumber}` : "no order number"}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      {selected && (
        <UtilizationDayDetail
          row={selected.row}
          day={selected.day}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
