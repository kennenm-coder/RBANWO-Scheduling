"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { useData } from "./DataProvider";
import AppointmentSheet from "./AppointmentSheet";
import ScheduleModal from "./ScheduleModal";
import {
  Appointment,
  Crew,
  TimeBlock,
  AppointmentType,
  RForceOrder,
  AvailabilityKind,
} from "@/lib/types";
import {
  getAppointmentsForCrewAndDay,
  MEASURE_TIME_BLOCKS,
  appointmentSpansBlock,
  typeLabel,
} from "@/lib/calendar-utils";
import { getTimeOffForDate } from "@/lib/store";
import { crewHasType, sortByFirstName, getDepartmentSectionsForDate } from "@/lib/crew-utils";
import { useSchedulerDrag } from "@/lib/drag-context";
import { useDragAutoScroll } from "@/lib/use-drag-autoscroll";
import { Palmtree } from "lucide-react";
import { getCrewDayLabels, LABEL_KIND_TEXT } from "@/lib/availability";
import {
  format,
  startOfWeek,
  addDays,
  isSameDay,
} from "date-fns";
import { useCurrentActor } from "./AuthProvider";
import { useToast } from "./Toast";
import { addMinutesToTime, getNextAvailableStart, getSchedulingMode, timeDurationMinutes } from "@/lib/scheduling-policy";

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

/** Compact Late Day / Office badges for a block-view day cell. */
function BlockDayLabels({ labels }: { labels: AvailabilityKind[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5 mb-0.5">
      {labels.map((k) => (
        <span
          key={k}
          className={`text-[8px] font-semibold leading-none px-0.5 py-px rounded ${
            k === "late_day"
              ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
              : "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300"
          }`}
        >
          {LABEL_KIND_TEXT[k]}
        </span>
      ))}
    </div>
  );
}

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
    rforceOrders,
    timeOffRequests,
    availabilityRules,
    availabilityExceptions,
    updateAppointment,
  } = useData();
  useCurrentActor(); // keep hook call order stable
  useToast(); // keep hook call order stable
  // Auto-scroll the grid while dragging a tile toward its top/bottom edge so
  // off-screen crews become reachable as drop targets.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { draggedAppointment: activeDrag, draggedOrder: activeOrder } = useSchedulerDrag();
  useDragAutoScroll(scrollRef, !!activeDrag || !!activeOrder);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [reschedulingAppt, setReschedulingAppt] = useState<Appointment | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    date: Date;
    crewId: string;
    timeBlock?: TimeBlock;
    prefill?: RForceOrder;
  } | null>(null);
  // When dragging an existing appointment to a new crew/date, open modal for confirmation
  const [moveConfirmAppt, setMoveConfirmAppt] = useState<Appointment | null>(null);
  const [moveConfirmTarget, setMoveConfirmTarget] = useState<{
    date: Date;
    crewId: string;
    startTime?: string;
    endTime?: string;
  } | null>(null);

  // Sun–Sat week
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 }); // Sunday
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  // Build date-aware department sections using role_assignment rules
  const deptSections = useMemo(
    () => getDepartmentSectionsForDate(crews, currentDate, availabilityRules, availabilityExceptions),
    [crews, currentDate, availabilityRules, availabilityExceptions]
  );

  // Map department sections to block view section configs
  const sectionForKey = (key: string) => deptSections.find((s) => s.key === key);
  const measureCrews = sectionForKey("measure")?.crews || [];
  const installCrews = sectionForKey("install")?.crews || [];
  const jipCrews = sectionForKey("jip")?.crews || [];
  const serviceCrews = sectionForKey("service")?.crews || [];

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

  const getDayLabels = useCallback(
    (crewId: string, day: Date) =>
      getCrewDayLabels(crewId, day, availabilityRules, availabilityExceptions),
    [availabilityRules, availabilityExceptions]
  );

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
    <div ref={scrollRef} className="flex-1 overflow-auto">
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
                  className={`border border-border p-1.5 text-center cursor-pointer hover:bg-primary/10 transition-colors bg-surface ${
                    isToday ? "!bg-primary/15 font-bold" : ""
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
              getDayLabels={getDayLabels}
              customerLastName={customerLastName}
              multiDayLabel={multiDayLabel}
              crewShortName={crewShortName}
              onAppointmentClick={setSelectedAppt}
              onQueueDrop={(order, crewId, day, block) =>
                setScheduleTarget({ date: day, crewId, timeBlock: block, prefill: order })
              }
              onAppointmentDrop={(draggedAppt, targetCrewId, targetDay) => {
                // Re-resolve by ID so the modal opens against the current
                // record/version, not the snapshot captured at drag start.
                const appt = appointments.find((a) => a.id === draggedAppt.id) ?? draggedAppt;
                const dateStr = format(targetDay, "yyyy-MM-dd");
                const existingEndTimes = appointments
                  .filter((candidate) =>
                    candidate.id !== appt.id &&
                    candidate.crew_id === targetCrewId &&
                    candidate.scheduled_date === dateStr &&
                    candidate.status !== "cancelled" &&
                    candidate.status !== "unscheduled" &&
                    !!candidate.end_time
                  )
                  .map((candidate) => candidate.end_time!);
                const nextStart = getSchedulingMode(appt.appointment_type) === "timed"
                  ? getNextAvailableStart(existingEndTimes, appt.appointment_type)
                  : undefined;
                const duration = timeDurationMinutes(
                  appt.start_time || "08:00",
                  appt.end_time || "09:00"
                );
                setMoveConfirmAppt(appt);
                setMoveConfirmTarget({
                  date: targetDay,
                  crewId: targetCrewId,
                  startTime: nextStart,
                  endTime: nextStart
                    ? addMinutesToTime(nextStart, Math.max(duration, 30))
                    : undefined,
                });
              }}
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

      {/* Queue drop → schedule modal */}
      {scheduleTarget && (
        <ScheduleModal
          date={scheduleTarget.date}
          crewId={scheduleTarget.crewId}
          timeBlock={scheduleTarget.timeBlock}
          prefill={scheduleTarget.prefill}
          onClose={() => setScheduleTarget(null)}
        />
      )}

      {/* Confirmation modal for appointment drops — lets scheduler review/change the calculated time */}
      {moveConfirmAppt && moveConfirmTarget && (
        <ScheduleModal
          date={moveConfirmTarget.date}
          crewId={moveConfirmTarget.crewId}
          editingAppointment={moveConfirmAppt}
          rescheduleMode
          initialStartTime={moveConfirmTarget.startTime}
          initialEndTime={moveConfirmTarget.endTime}
          onClose={() => {
            setMoveConfirmAppt(null);
            setMoveConfirmTarget(null);
          }}
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
  getDayLabels: (crewId: string, day: Date) => AvailabilityKind[];
  customerLastName: (appt: Appointment) => string;
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  onQueueDrop?: (order: RForceOrder, crewId: string, day: Date, block?: TimeBlock) => void;
  onAppointmentDrop?: (appt: Appointment, targetCrewId: string, targetDay: Date) => void;
  today: Date;
}

function SectionBlock({
  title,
  crews,
  weekDays,
  appointments,
  rowMode,
  isCrewOffOnDay,
  getDayLabels,
  customerLastName,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  onQueueDrop,
  onAppointmentDrop,
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
            getDayLabels={getDayLabels}
            multiDayLabel={multiDayLabel}
            crewShortName={crewShortName}
            onAppointmentClick={onAppointmentClick}
            onQueueDrop={onQueueDrop}
            onAppointmentDrop={onAppointmentDrop}
            today={today}
          />
        ) : rowMode === "hourly" ? (
          <HourlyCrewRows
            key={crew.id}
            crew={crew}
            weekDays={weekDays}
            appointments={appointments}
            isCrewOffOnDay={isCrewOffOnDay}
            getDayLabels={getDayLabels}
            multiDayLabel={multiDayLabel}
            crewShortName={crewShortName}
            onAppointmentClick={onAppointmentClick}
            onQueueDrop={onQueueDrop}
            onAppointmentDrop={onAppointmentDrop}
            today={today}
          />
        ) : (
          <CrewRow
            key={crew.id}
            crew={crew}
            weekDays={weekDays}
            appointments={appointments}
            isCrewOffOnDay={isCrewOffOnDay}
            getDayLabels={getDayLabels}
            customerLastName={customerLastName}
            multiDayLabel={multiDayLabel}
            crewShortName={crewShortName}
            onAppointmentClick={onAppointmentClick}
            onQueueDrop={onQueueDrop}
            onAppointmentDrop={onAppointmentDrop}
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
  getDayLabels: (crewId: string, day: Date) => AvailabilityKind[];
  customerLastName: (appt: Appointment) => string;
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  onQueueDrop?: (order: RForceOrder, crewId: string, day: Date, block?: TimeBlock) => void;
  onAppointmentDrop?: (appt: Appointment, targetCrewId: string, targetDay: Date) => void;
  today: Date;
}

function CrewRow({
  crew,
  weekDays,
  appointments,
  isCrewOffOnDay,
  getDayLabels,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  onQueueDrop,
  onAppointmentDrop,
  today,
}: CrewRowProps) {
  const { draggedOrder, draggedAppointment, setDraggedOrder, setDraggedAppointment } = useSchedulerDrag();
  const crewColor = crew.color || "#1a73e8";
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

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
        const dayKey = day.toISOString();
        const isDragOver = dragOverDay === dayKey;
        const dayAppts = getAppointmentsForCrewAndDay(
          appointments,
          crew.id,
          day
        ).filter(a => a.status !== "cancelled" && a.status !== "unscheduled");
        // PTO takes precedence over Late/Office tags — hide them when off.
        const dayLabels = off ? [] : getDayLabels(crew.id, day);

        return (
          <td
            key={dayKey}
            className={`border border-border p-0.5 align-top min-w-[120px] transition-colors ${
              isToday ? "bg-primary/5" : ""
            } ${isDragOver ? "!bg-primary/10 outline outline-2 outline-dashed outline-primary" : ""}`}
            onDragOver={(e) => {
              const order = draggedOrder;
              const dragged = draggedAppointment;
              if (!order && !dragged) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragOverDay !== dayKey) setDragOverDay(dayKey);
            }}
            onDragLeave={() => {
              if (dragOverDay === dayKey) setDragOverDay(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverDay(null);
              const order = draggedOrder;
              if (order) {
                onQueueDrop?.(order, crew.id, day, "full_day");
                setDraggedOrder(null);
                return;
              }
              const dragged = draggedAppointment;
              if (dragged) {
                onAppointmentDrop?.(dragged.appointment, crew.id, day);
                setDraggedAppointment(null);
              }
            }}
          >
            <BlockDayLabels labels={dayLabels} />
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
                    sourceCrewId={crew.id}
                    sourceDate={format(day, "yyyy-MM-dd")}
                    sourceTimeBlock={appt.time_block || null}
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
  getDayLabels: (crewId: string, day: Date) => AvailabilityKind[];
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  onQueueDrop?: (order: RForceOrder, crewId: string, day: Date, block?: TimeBlock) => void;
  onAppointmentDrop?: (appt: Appointment, targetCrewId: string, targetDay: Date) => void;
  today: Date;
}

function MeasureCrewRows({
  crew,
  weekDays,
  appointments,
  isCrewOffOnDay,
  getDayLabels,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  onQueueDrop,
  onAppointmentDrop,
  today,
}: MeasureCrewRowsProps) {
  const { draggedOrder, draggedAppointment, setDraggedOrder, setDraggedAppointment } = useSchedulerDrag();
  const crewColor = crew.color || "#1a73e8";
  const blocks = MEASURE_TIME_BLOCKS; // "9-10", "10-12", "12-2", "2-4", "4-6"
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

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
                    <BlockDayLabels labels={getDayLabels(crew.id, day)} />
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
            const cellKey = `${dateStr}-${block}`;
            const isDragOver = dragOverCell === cellKey;

            return (
              <td
                key={day.toISOString()}
                className={`border border-border/50 p-0.5 align-top text-[10px] transition-colors ${
                  isToday ? "bg-primary/5" : ""
                } ${isDragOver ? "!bg-primary/10 outline outline-2 outline-dashed outline-primary" : ""}`}
                onDragOver={(e) => {
                  const order = draggedOrder;
                  const dragged = draggedAppointment;
                  if (!order && !dragged) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverCell !== cellKey) setDragOverCell(cellKey);
                }}
                onDragLeave={() => {
                  if (dragOverCell === cellKey) setDragOverCell(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCell(null);
                  const order = draggedOrder;
                  if (order) {
                    onQueueDrop?.(order, crew.id, day, block as TimeBlock);
                    setDraggedOrder(null);
                    return;
                  }
                  const dragged = draggedAppointment;
                  if (dragged) {
                    onAppointmentDrop?.(dragged.appointment, crew.id, day);
                    setDraggedAppointment(null);
                  }
                }}
              >
                {blockIdx === 0 && <BlockDayLabels labels={getDayLabels(crew.id, day)} />}
                {fullDayAppts.map((appt) => (
                  <BlockCell
                    key={appt.id}
                    appointment={appt}
                    label={multiDayLabel(appt, day)}
                    crewColor={crewColor}
                    onClick={() => onAppointmentClick(appt)}
                    small
                    sourceCrewId={crew.id}
                    sourceDate={dateStr}
                    sourceTimeBlock={appt.time_block || null}
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
                    sourceCrewId={crew.id}
                    sourceDate={dateStr}
                    sourceTimeBlock={appt.time_block || null}
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
  getDayLabels: (crewId: string, day: Date) => AvailabilityKind[];
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  onQueueDrop?: (order: RForceOrder, crewId: string, day: Date, block?: TimeBlock) => void;
  onAppointmentDrop?: (appt: Appointment, targetCrewId: string, targetDay: Date) => void;
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
  getDayLabels,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  onQueueDrop,
  onAppointmentDrop,
  today,
}: HourlyCrewRowsProps) {
  const { draggedOrder, draggedAppointment, setDraggedOrder, setDraggedAppointment } = useSchedulerDrag();
  const crewColor = crew.color || "#1a73e8";
  const hours = SERVICE_HOURS;
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

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

  // Lay each day's appointments into the hourly slots. An appointment sits in
  // the slot for the hour it STARTS in and spans downward to cover every hour
  // its end time reaches (a 1–3pm service covers the 1pm and 2pm rows). Slots
  // covered by a spanning appointment above are skipped so the grid stays clean.
  const planByDay = useMemo(() => {
    const n: number = hours.length;
    const firstHour: number = hours[0];
    const lastHour: number = hours[n - 1];

    function placement(a: Appointment): { startIdx: number; span: number } {
      // All-day / untimed work pins to the first row.
      if (a.time_block === "full_day") return { startIdx: 0, span: 1 };
      const startH = getAppointmentStartHour(a);
      if (startH === null) return { startIdx: 0, span: 1 };
      const displayStart = Math.min(Math.max(startH, firstHour), lastHour);
      const startIdx = displayStart - firstHour;
      let span = 1;
      if (a.end_time) {
        const [ehStr, emStr] = a.end_time.split(":");
        const eh = parseInt(ehStr, 10);
        const em = parseInt(emStr || "0", 10);
        if (!isNaN(eh)) {
          const endEff = em > 0 ? eh + 1 : eh; // partial hour rounds up
          span = Math.max(1, endEff - displayStart);
        }
      }
      return { startIdx, span: Math.min(span, n - startIdx) };
    }

    type HourCellPlan =
      | { skip: true }
      | { skip: false; appts: Appointment[]; rowSpan: number };

    const map = new Map<string, HourCellPlan[]>();
    for (const day of weekDays) {
      const dateStr = format(day, "yyyy-MM-dd");
      const dayAppts = dayApptsMap.get(dateStr) || [];

      const apptsByStart: Appointment[][] = hours.map(() => []);
      const spanByStart: number[] = hours.map(() => 1);
      for (const a of dayAppts) {
        const { startIdx, span } = placement(a);
        apptsByStart[startIdx].push(a);
        spanByStart[startIdx] = Math.max(spanByStart[startIdx], span);
      }

      const covered = new Array<boolean>(n).fill(false);
      const plan: HourCellPlan[] = [];
      for (let i = 0; i < n; i++) {
        if (covered[i]) { plan.push({ skip: true }); continue; }
        const appts = apptsByStart[i];
        if (appts.length === 0) { plan.push({ skip: false, appts: [], rowSpan: 1 }); continue; }
        // Never span across a later hour that has its own appointments — it gets
        // its own row instead of being swallowed by this chip.
        let nextNonEmpty = n;
        for (let j = i + 1; j < n; j++) {
          if (apptsByStart[j].length > 0) { nextNonEmpty = j; break; }
        }
        const span = Math.max(1, Math.min(spanByStart[i], nextNonEmpty - i, n - i));
        for (let k = i + 1; k < i + span; k++) covered[k] = true;
        plan.push({ skip: false, appts, rowSpan: span });
      }
      map.set(dateStr, plan);
    }
    return map;
  }, [dayApptsMap, weekDays, hours]);

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

            if (off) {
              if (hourIdx === 0) {
                return (
                  <td
                    key={day.toISOString()}
                    rowSpan={hours.length}
                    className={`border border-border p-0.5 text-center align-middle ${isToday ? "bg-primary/5" : ""}`}
                  >
                    <BlockDayLabels labels={getDayLabels(crew.id, day)} />
                    <div className="flex items-center justify-center text-muted opacity-60">
                      <Palmtree size={12} className="mr-1" />
                      <span className="text-[10px]">OFF</span>
                    </div>
                  </td>
                );
              }
              return null;
            }

            const plan = planByDay.get(dateStr)?.[hourIdx];
            if (!plan || plan.skip) return null; // covered by a spanning chip above

            const cellKey = `${dateStr}-h${hour}`;
            const isDragOver = dragOverCell === cellKey;
            // Convert hour to a time block string for the drop target
            const hourBlock = `${hour}-${hour + 1}` as TimeBlock;

            return (
              <td
                key={day.toISOString()}
                rowSpan={plan.rowSpan}
                className={`border border-border/50 p-0.5 align-top text-[10px] transition-colors ${
                  isToday ? "bg-primary/5" : ""
                } ${isDragOver ? "!bg-primary/10 outline outline-2 outline-dashed outline-primary" : ""}`}
                onDragOver={(e) => {
                  const order = draggedOrder;
                  const dragged = draggedAppointment;
                  if (!order && !dragged) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverCell !== cellKey) setDragOverCell(cellKey);
                }}
                onDragLeave={() => {
                  if (dragOverCell === cellKey) setDragOverCell(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCell(null);
                  const order = draggedOrder;
                  if (order) {
                    onQueueDrop?.(order, crew.id, day, hourBlock);
                    setDraggedOrder(null);
                    return;
                  }
                  const dragged = draggedAppointment;
                  if (dragged) {
                    onAppointmentDrop?.(dragged.appointment, crew.id, day);
                    setDraggedAppointment(null);
                  }
                }}
              >
                {hourIdx === 0 && <BlockDayLabels labels={getDayLabels(crew.id, day)} />}
                {plan.appts.length === 0 ? (
                  <div className="min-h-[18px]" />
                ) : (
                  <div className="flex flex-col gap-0.5 h-full">
                    {plan.appts.map((appt) => (
                      <BlockCell
                        key={appt.id}
                        appointment={appt}
                        label={multiDayLabel(appt, day)}
                        crewColor={crewColor}
                        onClick={() => onAppointmentClick(appt)}
                        small
                        heightRows={plan.appts.length === 1 ? plan.rowSpan : undefined}
                        sourceCrewId={crew.id}
                        sourceDate={dateStr}
                        sourceTimeBlock={appt.time_block || null}
                      />
                    ))}
                  </div>
                )}
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
  sourceCrewId?: string;
  sourceDate?: string;
  sourceTimeBlock?: TimeBlock | null;
  /** When set (>1), the chip is sized to span that many hour rows. */
  heightRows?: number;
}

function BlockCell({
  appointment,
  label,
  crewColor,
  onClick,
  small,
  sourceCrewId,
  sourceDate,
  sourceTimeBlock,
  heightRows,
}: BlockCellProps) {
  const { setDraggedAppointment } = useSchedulerDrag();
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
      draggable
      onClick={onClick}
      tabIndex={0}
      aria-label={`Open ${appointment.customer_name} appointment`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onDragStart={(e) => {
        setDraggedAppointment({
          appointment,
          sourceCrewId: sourceCrewId || "",
          sourceDate: sourceDate || "",
          sourceTimeBlock: sourceTimeBlock ?? null,
        });
        e.dataTransfer.effectAllowed = "move";
        (e.currentTarget as HTMLElement).style.opacity = "0.4";
      }}
      onDragEnd={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = "1";
        setDraggedAppointment(null);
      }}
      className={`group/block relative rounded px-1.5 cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow text-white truncate ${
        small ? "py-0 text-[10px] leading-snug" : "py-0.5 text-[11px] leading-tight"
      }`}
      style={{
        backgroundColor: crewColor,
        minHeight: heightRows && heightRows > 1 ? `${heightRows * 20}px` : undefined,
      }}
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
