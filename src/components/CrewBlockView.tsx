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

// Short block labels for service hourly rows
const BLOCK_SHORT_LABELS: Record<string, string> = {
  "9-10": "9a",
  "10-12": "10a",
  "12-2": "12p",
  "2-4": "2p",
  "4-6": "4p",
};

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
    isService: boolean;
  }[] = [];

  if (filterType === "all" || filterType === "tech_measure") {
    if (measureCrews.length > 0)
      sections.push({ title: "MEASURES", crews: measureCrews, isService: false });
  }
  if (filterType === "all" || filterType === "install") {
    if (installCrews.length > 0)
      sections.push({ title: "INSTALLS", crews: installCrews, isService: false });
  }
  if (filterType === "all" || filterType === "jip") {
    if (jipCrews.length > 0)
      sections.push({ title: "JIPS/WOP", crews: jipCrews, isService: false });
  }
  if (filterType === "all" || filterType === "service") {
    if (serviceCrews.length > 0)
      // Service appointments are all full_day, so one row per crew like installs.
      // If hourly time_blocks are used in the future, set isService: true to
      // enable per-block sub-rows.
      sections.push({ title: "SERVICE", crews: serviceCrews, isService: false });
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
              isService={section.isService}
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
          mode="edit"
          appointment={editingAppt}
          onClose={() => setEditingAppt(null)}
        />
      )}

      {/* Reschedule modal */}
      {reschedulingAppt && (
        <ScheduleModal
          mode="reschedule"
          appointment={reschedulingAppt}
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
  isService: boolean;
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
  isService,
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
        isService ? (
          // Service crews get hourly sub-rows
          <ServiceCrewRows
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
          // All other crews get one row
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

// ─── Service Crew with Hourly Sub-rows ───────────────────────────────────────

interface ServiceCrewRowsProps {
  crew: Crew;
  weekDays: Date[];
  appointments: Appointment[];
  isCrewOffOnDay: (crew: Crew, day: Date) => boolean;
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  today: Date;
}

function ServiceCrewRows({
  crew,
  weekDays,
  appointments,
  isCrewOffOnDay,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  today,
}: ServiceCrewRowsProps) {
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

  // Also check for full_day appointments (service crew might have those)
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
          {/* Crew name only on first row, spans all block rows */}
          {blockIdx === 0 && (
            <td
              className="border border-border p-1.5 font-semibold whitespace-nowrap text-[11px] align-top"
              rowSpan={blocks.length}
              style={{
                borderLeft: `3px solid ${crewColor}`,
              }}
              title={crew.name}
            >
              <div>{crewShortName(crew)}</div>
              <div className="text-[9px] text-muted font-normal mt-1 space-y-px">
                {blocks.map((b) => (
                  <div key={b}>{BLOCK_SHORT_LABELS[b] || b}</div>
                ))}
              </div>
            </td>
          )}

          {/* Day cells for this time block */}
          {weekDays.map((day) => {
            const isToday = isSameDay(day, today);
            const off = isCrewOffOnDay(crew, day);
            const dateStr = format(day, "yyyy-MM-dd");
            const dayAppts = dayApptsMap.get(dateStr) || [];

            // Show OFF only on first block row
            if (off) {
              if (blockIdx === 0) {
                return (
                  <td
                    key={day.toISOString()}
                    rowSpan={blocks.length}
                    className={`border border-border p-0.5 text-center align-middle ${
                      isToday ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-center justify-center text-muted opacity-60">
                      <Palmtree size={12} className="mr-1" />
                      <span className="text-[10px]">OFF</span>
                    </div>
                  </td>
                );
              }
              // Skip cells that are part of the OFF rowSpan
              return null;
            }

            // Find appointments that span this time block
            const blockAppts = dayAppts.filter(
              (a) => a.time_block && appointmentSpansBlock(a, block)
            );

            // Full-day appointments show on first block row only
            const fullDayAppts =
              blockIdx === 0 ? (fullDayByDay.get(dateStr) || []) : [];

            return (
              <td
                key={day.toISOString()}
                className={`border border-border/50 p-0.5 align-top text-[10px] ${
                  isToday ? "bg-primary/5" : ""
                }`}
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
