"use client";

import { useState, useMemo } from "react";
import { useData } from "./DataProvider";
import AppointmentSheet from "./AppointmentSheet";
import ScheduleModal from "./ScheduleModal";
import {
  Appointment,
  Crew,
  TimeBlock,
  AppointmentType,
} from "@/lib/types";
import {
  getAppointmentsForCrewAndDay,
  MEASURE_TIME_BLOCKS,
  appointmentSpansBlock,
  typeLabel,
} from "@/lib/calendar-utils";
import { getTimeOffForDate } from "@/lib/store";
import { crewHasType, sortByFirstName } from "@/lib/crew-utils";
import { Palmtree } from "lucide-react";
import {
  format,
  startOfWeek,
  addDays,
  isSameDay,
} from "date-fns";

// Measure tech block labels (2-hour blocks)
const MEASURE_BLOCK_LABELS: Record<string, string> = {
  "9-10": "9–10a",
  "10-12": "10–12",
  "12-2": "12–2p",
  "2-4": "2–4p",
  "4-6": "4–6p",
};

// Service/JIP hourly slots (individual hours 9am–5pm, matching Calendar Doc)
const SERVICE_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17] as const;
const SERVICE_HOUR_LABELS: Record<number, string> = {
  9: "9",
  10: "10",
  11: "11",
  12: "12",
  13: "1",
  14: "2",
  15: "3",
  16: "4",
  17: "5",
};

// Row mode: "single" = one row, "measure_blocks" = 5 two-hour blocks, "hourly" = 9 hourly slots
type RowMode = "single" | "measure_blocks" | "hourly";

interface Props {
  currentDate: Date;
  filterType?: AppointmentType | "all";
  onDayClick?: (date: Date) => void;
}

export default function CrewBlockView({
  currentDate,
  filterType = "all",
  onDayClick,
}: Props) {
  const {
    crews,
    appointments,
    timeOffRequests,
    updateAppointment,
  } = useData();
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [reschedulingAppt, setReschedulingAppt] = useState<Appointment | null>(null);

  // Sun–Sat week
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 }); // Sunday
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  // Crew groups (same logic as day/week view)
  const activeCrews = crews.filter((c) => c.is_active);
  const mainCrews = activeCrews.filter(
    (c) => !crewHasType(c, "misc", "second", "management")
  );
  const measureCrews = sortByFirstName(
    mainCrews.filter((c) => crewHasType(c, "measure_tech"))
  );
  const installCrews = sortByFirstName(
    mainCrews.filter((c) =>
      crewHasType(c, "install_in_house", "install_sub")
    )
  );
  const jipCrews = sortByFirstName(
    mainCrews.filter((c) => crewHasType(c, "jip"))
  );
  const serviceCrews = sortByFirstName(
    mainCrews.filter((c) => crewHasType(c, "svc"))
  );

  // Time-off lookup per day
  const offByDay = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const day of weekDays) {
      const dateStr = format(day, "yyyy-MM-dd");
      const off = getTimeOffForDate(timeOffRequests, dateStr);
      const names = new Set(off.map((r) => r.employee_name.toLowerCase()));
      map.set(dateStr, names);
    }
    return map;
  }, [timeOffRequests, weekDays]);

  function isCrewOffOnDay(crew: Crew, day: Date): boolean {
    const dateStr = format(day, "yyyy-MM-dd");
    const names = offByDay.get(dateStr);
    if (!names) return false;
    if (names.has(crew.name.toLowerCase())) return true;
    if (crew.aliases) {
      for (const alias of crew.aliases) {
        if (names.has(alias.toLowerCase())) return true;
      }
    }
    return false;
  }

  // Get customer last name for compact display
  function customerLastName(appt: Appointment): string {
    const name = appt.customer_name || "";
    const parts = name.trim().split(/\s+/);
    if (parts.length <= 1) return name;
    return parts[parts.length - 1];
  }

  // Multi-day fraction label: "Smith (1/3)"
  function multiDayLabel(appt: Appointment, day: Date): string {
    const lastName = customerLastName(appt);
    if (appt.duration_days <= 1) return lastName;
    if (!appt.scheduled_date) return lastName;
    const start = new Date(appt.scheduled_date + "T00:00:00");
    const dayNum = Math.round(
      (day.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;
    return `${lastName} (${dayNum}/${appt.duration_days})`;
  }

  // Crew short name (first name or initials from spreadsheet style)
  function crewShortName(crew: Crew): string {
    const parts = crew.name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0]} ${parts[1][0]}`;
    }
    return crew.name;
  }

  // Filter sections by filterType
  const sections: {
    title: string;
    crews: Crew[];
    rowMode: RowMode;
  }[] = [];

  if (filterType === "all" || filterType === "tech_measure") {
    if (measureCrews.length > 0)
      sections.push({ title: "MEASURES", crews: measureCrews, rowMode: "measure_blocks" });
  }
  if (filterType === "all" || filterType === "install") {
    if (installCrews.length > 0)
      sections.push({ title: "INSTALLS", crews: installCrews, rowMode: "single" });
  }
  if (filterType === "all" || filterType === "jip") {
    if (jipCrews.length > 0)
      sections.push({ title: "JIPS/WOP", crews: jipCrews, rowMode: "hourly" });
  }
  if (filterType === "all" || filterType === "service") {
    if (serviceCrews.length > 0)
      sections.push({ title: "SERVICE", crews: serviceCrews, rowMode: "hourly" });
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
        {/* Header: Sun–Sat */}
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            <th className="border border-border p-1.5 text-left w-[100px] min-w-[100px] bg-surface">
              Crew
            </th>
            {weekDays.map((day) => {
              const isToday = isSameDay(day, today);
              return (
                <th
                  key={day.toISOString()}
                  className={`border border-border p-1.5 text-center cursor-pointer hover:bg-primary/10 transition-colors ${
                    isToday ? "bg-primary/15 font-bold" : ""
                  }`}
                  onClick={() => onDayClick?.(day)}
                  title={`Click to open ${format(day, "EEEE, MMM d")} in day view`}
                >
                  <div className="text-[10px] uppercase text-muted">
                    {format(day, "EEE")}
                  </div>
                  <div className={isToday ? "text-primary" : ""}>
                    {format(day, "M/d")}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {sections.map((section) => (
            <SectionBlock
              key={section.title}
              title={section.title}
              crews={section.crews}
              weekDays={weekDays}
              appointments={appointments}
              rowMode={section.rowMode}
              isCrewOffOnDay={isCrewOffOnDay}
              customerLastName={customerLastName}
              multiDayLabel={multiDayLabel}
              crewShortName={crewShortName}
              onAppointmentClick={setSelectedAppt}
              today={today}
            />
          ))}
        </tbody>
      </table>

      {/* Appointment detail sheet */}
      {selectedAppt && (
        <AppointmentSheet
          appointment={selectedAppt}
          onClose={() => setSelectedAppt(null)}
          onEdit={() => {
            setEditingAppt(selectedAppt);
            setSelectedAppt(null);
          }}
          onReschedule={() => {
            setReschedulingAppt(selectedAppt);
            setSelectedAppt(null);
          }}
        />
      )}

      {/* Edit modal */}
      {editingAppt && (
        <ScheduleModal
          date={editingAppt.scheduled_date ? new Date(editingAppt.scheduled_date + "T00:00:00") : new Date()}
          editingAppointment={editingAppt}
          onClose={() => setEditingAppt(null)}
        />
      )}

      {/* Reschedule modal */}
      {reschedulingAppt && (
        <ScheduleModal
          date={reschedulingAppt.scheduled_date ? new Date(reschedulingAppt.scheduled_date + "T00:00:00") : new Date()}
          editingAppointment={reschedulingAppt}
          rescheduleMode
          onClose={() => setReschedulingAppt(null)}
        />
      )}
    </div>
  );
}

// ─── Section Block (e.g. "INSTALLS") ─────────────────────────────────────────

interface SectionBlockProps {
  title: string;
  crews: Crew[];
  weekDays: Date[];
  appointments: Appointment[];
  rowMode: RowMode;
  isCrewOffOnDay: (crew: Crew, day: Date) => boolean;
  customerLastName: (appt: Appointment) => string;
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  today: Date;
}

function SectionBlock({
  title,
  crews,
  weekDays,
  appointments,
  rowMode,
  isCrewOffOnDay,
  customerLastName,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  today,
}: SectionBlockProps) {
  return (
    <>
      {/* Section header row */}
      <tr>
        <td
          colSpan={8}
          className="border border-border p-1.5 bg-surface font-bold text-[11px] uppercase tracking-wider text-muted"
        >
          {title}
        </td>
      </tr>

      {crews.map((crew) =>
        rowMode === "measure_blocks" ? (
          <MeasureCrewRows
            key={crew.id}
            crew={crew}
            weekDays={weekDays}
            appointments={appointments}
            isCrewOffOnDay={isCrewOffOnDay}
            multiDayLabel={multiDayLabel}
            crewShortName={crewShortName}
            onAppointmentClick={onAppointmentClick}
            today={today}
          />
        ) : rowMode === "hourly" ? (
          <HourlyCrewRows
            key={crew.id}
            crew={crew}
            weekDays={weekDays}
            appointments={appointments}
            isCrewOffOnDay={isCrewOffOnDay}
            multiDayLabel={multiDayLabel}
            crewShortName={crewShortName}
            onAppointmentClick={onAppointmentClick}
            today={today}
          />
        ) : (
          <CrewRow
            key={crew.id}
            crew={crew}
            weekDays={weekDays}
            appointments={appointments}
            isCrewOffOnDay={isCrewOffOnDay}
            customerLastName={customerLastName}
            multiDayLabel={multiDayLabel}
            crewShortName={crewShortName}
            onAppointmentClick={onAppointmentClick}
            today={today}
          />
        )
      )}
    </>
  );
}

// ─── Single Crew Row (installs, JIP, measures) ──────────────────────────────

interface CrewRowProps {
  crew: Crew;
  weekDays: Date[];
  appointments: Appointment[];
  isCrewOffOnDay: (crew: Crew, day: Date) => boolean;
  customerLastName: (appt: Appointment) => string;
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  today: Date;
}

function CrewRow({
  crew,
  weekDays,
  appointments,
  isCrewOffOnDay,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  today,
}: CrewRowProps) {
  const crewColor = crew.color || "#1a73e8";

  return (
    <tr>
      {/* Crew name cell */}
      <td
        className="border border-border p-1.5 font-semibold whitespace-nowrap text-[11px]"
        style={{
          borderLeft: `3px solid ${crewColor}`,
        }}
        title={crew.name}
      >
        {crewShortName(crew)}
      </td>

      {/* Day cells */}
      {weekDays.map((day) => {
        const isToday = isSameDay(day, today);
        const off = isCrewOffOnDay(crew, day);
        const dayAppts = getAppointmentsForCrewAndDay(
          appointments,
          crew.id,
          day
        ).filter(a => a.status !== "cancelled" && a.status !== "unscheduled");

        return (
          <td
            key={day.toISOString()}
            className={`border border-border p-0.5 align-top min-w-[120px] ${
              isToday ? "bg-primary/5" : ""
            }`}
          >
            {off ? (
              <div className="flex items-center justify-center h-full text-muted opacity-60 py-1">
                <Palmtree size={12} className="mr-1" />
                <span className="text-[10px]">OFF</span>
              </div>
            ) : dayAppts.length === 0 ? null : (
              <div className="flex flex-col gap-0.5">
                {dayAppts.map((appt) => (
                  <BlockCell
                    key={appt.id}
                    appointment={appt}
                    label={multiDayLabel(appt, day)}
                    crewColor={crewColor}
                    onClick={() => onAppointmentClick(appt)}
                  />
                ))}
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ─── Measure Crew with 2-hour Block Sub-rows ───────────────────────────────

interface MeasureCrewRowsProps {
  crew: Crew;
  weekDays: Date[];
  appointments: Appointment[];
  isCrewOffOnDay: (crew: Crew, day: Date) => boolean;
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  today: Date;
}

function MeasureCrewRows({
  crew,
  weekDays,
  appointments,
  isCrewOffOnDay,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  today,
}: MeasureCrewRowsProps) {
  const crewColor = crew.color || "#1a73e8";
  const blocks = MEASURE_TIME_BLOCKS; // "9-10", "10-12", "12-2", "2-4", "4-6"

  // Pre-compute appointments per day
  const dayApptsMap = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const day of weekDays) {
      const dateStr = format(day, "yyyy-MM-dd");
      const dayAppts = getAppointmentsForCrewAndDay(
        appointments,
        crew.id,
        day
      ).filter(a => a.status !== "cancelled" && a.status !== "unscheduled");
      map.set(dateStr, dayAppts);
    }
    return map;
  }, [appointments, crew.id, weekDays]);

  // Full-day appointments
  const fullDayByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const day of weekDays) {
      const dateStr = format(day, "yyyy-MM-dd");
      const dayAppts = dayApptsMap.get(dateStr) || [];
      const fullDay = dayAppts.filter(
        (a) => a.time_block === "full_day" || !a.time_block
      );
      map.set(dateStr, fullDay);
    }
    return map;
  }, [dayApptsMap, weekDays]);

  return (
    <>
      {blocks.map((block, blockIdx) => (
        <tr key={`${crew.id}-${block}`}>
          {/* Crew name + time label — each row gets its own cell for alignment */}
          <td
            className={`border border-border p-1 whitespace-nowrap text-[11px] ${blockIdx === 0 ? "border-t" : "border-t-0"}`}
            style={{ borderLeft: `3px solid ${crewColor}` }}
            title={crew.name}
          >
            {blockIdx === 0 && (
              <div className="font-semibold">{crewShortName(crew)}</div>
            )}
            <div className="text-[9px] text-muted font-normal">{MEASURE_BLOCK_LABELS[block] || block}</div>
          </td>

          {weekDays.map((day) => {
            const isToday = isSameDay(day, today);
            const off = isCrewOffOnDay(crew, day);
            const dateStr = format(day, "yyyy-MM-dd");
            const dayAppts = dayApptsMap.get(dateStr) || [];

            if (off) {
              if (blockIdx === 0) {
                return (
                  <td
                    key={day.toISOString()}
                    rowSpan={blocks.length}
                    className={`border border-border p-0.5 text-center align-middle ${isToday ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-center justify-center text-muted opacity-60">
                      <Palmtree size={12} className="mr-1" />
                      <span className="text-[10px]">OFF</span>
                    </div>
                  </td>
                );
              }
              return null;
            }

            const blockAppts = dayAppts.filter(
              (a) => a.time_block && appointmentSpansBlock(a, block)
            );
            const fullDayAppts = blockIdx === 0 ? (fullDayByDay.get(dateStr) || []) : [];

            return (
              <td
                key={day.toISOString()}
                className={`border border-border/50 p-0.5 align-top text-[10px] ${isToday ? "bg-primary/5" : ""}`}
              >
                {fullDayAppts.map((appt) => (
                  <BlockCell
                    key={appt.id}
                    appointment={appt}
                    label={multiDayLabel(appt, day)}
                    crewColor={crewColor}
                    onClick={() => onAppointmentClick(appt)}
                    small
                  />
                ))}
                {blockAppts.map((appt) => (
                  <BlockCell
                    key={appt.id}
                    appointment={appt}
                    label={multiDayLabel(appt, day)}
                    crewColor={crewColor}
                    onClick={() => onAppointmentClick(appt)}
                    small
                  />
                ))}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

// ─── Hourly Crew Rows (Service / JIP — 9am–5pm individual hours) ────────────

interface HourlyCrewRowsProps {
  crew: Crew;
  weekDays: Date[];
  appointments: Appointment[];
  isCrewOffOnDay: (crew: Crew, day: Date) => boolean;
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  today: Date;
}

/** Parse the starting hour (0–23) from an appointment's start_time or time_block. */
function getAppointmentStartHour(appt: Appointment): number | null {
  // Prefer start_time ("09:00:00", "14:00:00", etc.)
  if (appt.start_time) {
    const h = parseInt(appt.start_time.split(":")[0], 10);
    if (!isNaN(h)) return h;
  }
  // Fall back to time_block
  if (appt.time_block && appt.time_block !== "full_day") {
    const h = parseInt(appt.time_block.split("-")[0], 10);
    if (!isNaN(h)) return h;
  }
  return null;
}

function HourlyCrewRows({
  crew,
  weekDays,
  appointments,
  isCrewOffOnDay,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  today,
}: HourlyCrewRowsProps) {
  const crewColor = crew.color || "#1a73e8";
  const hours = SERVICE_HOURS;

  const dayApptsMap = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const day of weekDays) {
      const dateStr = format(day, "yyyy-MM-dd");
      const dayAppts = getAppointmentsForCrewAndDay(
        appointments,
        crew.id,
        day
      ).filter(a => a.status !== "cancelled" && a.status !== "unscheduled");
      map.set(dateStr, dayAppts);
    }
    return map;
  }, [appointments, crew.id, weekDays]);

  return (
    <>
      {hours.map((hour, hourIdx) => (
        <tr key={`${crew.id}-h${hour}`}>
          {/* Crew name + hour label — each row gets its own cell for alignment */}
          <td
            className={`border border-border p-1 whitespace-nowrap text-[11px] ${hourIdx === 0 ? "border-t" : "border-t-0"}`}
            style={{ borderLeft: `3px solid ${crewColor}` }}
            title={crew.name}
          >
            {hourIdx === 0 && (
              <div className="font-semibold">{crewShortName(crew)}</div>
            )}
            <div className="text-[9px] text-muted font-normal">{SERVICE_HOUR_LABELS[hour]}</div>
          </td>

          {weekDays.map((day) => {
            const isToday = isSameDay(day, today);
            const off = isCrewOffOnDay(crew, day);
            const dateStr = format(day, "yyyy-MM-dd");
            const dayAppts = dayApptsMap.get(dateStr) || [];

            if (off) {
              if (hourIdx === 0) {
                return (
                  <td
                    key={day.toISOString()}
                    rowSpan={hours.length}
                    className={`border border-border p-0.5 text-center align-middle ${isToday ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-center justify-center text-muted opacity-60">
                      <Palmtree size={12} className="mr-1" />
                      <span className="text-[10px]">OFF</span>
                    </div>
                  </td>
                );
              }
              return null;
            }

            // Match appointments to this hour:
            // - full_day / no time_block → show on the first hour row only
            // - specific time → show on the matching hour
            const hourAppts = dayAppts.filter((a) => {
              if (a.time_block === "full_day" || !a.time_block) {
                return hourIdx === 0; // full-day shows on first row
              }
              const startH = getAppointmentStartHour(a);
              return startH === hour;
            });

            return (
              <td
                key={day.toISOString()}
                className={`border border-border/50 p-0.5 align-top text-[10px] ${isToday ? "bg-primary/5" : ""}`}
              >
                {hourAppts.map((appt) => (
                  <BlockCell
                    key={appt.id}
                    appointment={appt}
                    label={multiDayLabel(appt, day)}
                    crewColor={crewColor}
                    onClick={() => onAppointmentClick(appt)}
                    small
                  />
                ))}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

// ─── Block Cell (the compact colored chip per appointment) ───────────────────

interface BlockCellProps {
  appointment: Appointment;
  label: string;
  crewColor: string;
  onClick: () => void;
  small?: boolean;
}

function BlockCell({
  appointment,
  label,
  crewColor,
  onClick,
  small,
}: BlockCellProps) {
  const { unscheduleAppointment } = useData();
  const [unscheduling, setUnscheduling] = useState(false);

  const handleUnschedule = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (unscheduling) return;
    if (
      !confirm(
        `Unschedule ${appointment.customer_name}? It will return to the queue.`
      )
    )
      return;
    setUnscheduling(true);
    try {
      await unscheduleAppointment(
        appointment.id,
        appointment.version,
        "Unscheduled from calendar"
      );
    } catch {
      alert("Failed to unschedule. The appointment may have been modified.");
    } finally {
      setUnscheduling(false);
    }
  };

  return (
    <div
      onClick={onClick}
      className={`group/block relative rounded px-1.5 cursor-pointer hover:shadow-sm transition-shadow text-white truncate ${
        small ? "py-0 text-[10px] leading-snug" : "py-0.5 text-[11px] leading-tight"
      }`}
      style={{ backgroundColor: crewColor }}
      title={`${appointment.customer_name} — ${appointment.address || ""} (${typeLabel(appointment.appointment_type)})`}
    >
      <span className="pr-3">{label}</span>
      {appointment.duration_days > 1 && (
        <span className="text-[9px] opacity-70 ml-0.5">
          📅
        </span>
      )}
      {/* Hover unschedule button */}
      <button
        onClick={handleUnschedule}
        disabled={unscheduling}
        className="absolute top-0 right-0 p-0.5 rounded-full bg-black/30 hover:bg-red-600 text-white opacity-0 group-hover/block:opacity-100 transition-opacity"
        title="Unschedule — return to queue"
        aria-label="Unschedule appointment"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
        </svg>
      </button>
    </div>
  );
}
