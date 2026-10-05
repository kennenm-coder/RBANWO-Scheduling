"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { useData } from "./DataProvider";
import { crewColorFor, getPreferences } from "@/lib/preferences";
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
  MEASURE_ROW_BLOCKS,
  REMOTE_BLOCK,
  appointmentOccupiesBlock,
  isAllDayWork,
  typeLabel,
  timeBlockStartEnd,
} from "@/lib/calendar-utils";
import { getTimeOffForDate } from "@/lib/store";
import {
  crewHasType,
  sortByFirstName,
  getDepartmentSections,
  getCrewRoleBlock,
  getCrewRoleTag,
  isForeignToSection,
  foreignTypeBadge,
  RoleBlock,
} from "@/lib/crew-utils";
import { useSchedulerDrag } from "@/lib/drag-context";
import { usePresence } from "@/lib/presence";
import { useDragAutoScroll } from "@/lib/use-drag-autoscroll";
import { Palmtree, ArrowRight, Ban, Sunset, Building2 } from "lucide-react";
import { getCrewDayLabels, LABEL_KIND_TEXT, getCrewAvailability } from "@/lib/availability";
import {
  blockedVisualFor,
  timeOffVisual,
  blockedCellStyle,
  blockedSlotStyle,
  BlockedVisual,
} from "@/lib/blocked-visuals";
import {
  format,
  startOfWeek,
  addDays,
  isSameDay,
} from "date-fns";
import { useCurrentActor } from "./AuthProvider";
import { useToast } from "./Toast";
import { addMinutesToTime, getNextAvailableStart, getSchedulingMode, timeDurationMinutes } from "@/lib/scheduling-policy";

// Measure tech row labels — the remote row, then the 2-hour on-site blocks
const MEASURE_BLOCK_LABELS: Record<string, string> = {
  remote: "Remote",
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
/**
 * Diagonal hatch marking a cell that is reserved by another department. Kept
 * visually distinct from the PTO treatment: the person IS working that day.
 */
const ROLE_BLOCKED_HATCH =
  "bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(127,127,127,0.13)_4px,rgba(127,127,127,0.13)_8px)]";

/**
 * A day a dual-role resource is assigned to a different department.
 *
 * Deliberately NOT the palm tree / OFF treatment used for time off — a
 * scheduler has to be able to tell "working, just not for me today" from "not
 * here at all" without reading the tooltip.
 */
function RoleBlockedCell({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-0.5 text-muted/80">
      <ArrowRight size={10} />
      <span className="text-[10px] font-medium">{label}</span>
    </div>
  );
}

function BlockedMark({
  visual,
  reason,
  size = "normal",
}: {
  visual: BlockedVisual;
  reason: string;
  size?: "normal" | "small";
}) {
  const Icon =
    visual.icon === "ban" ? Ban : visual.icon === "sunset" ? Sunset : visual.icon === "building" ? Building2 : Palmtree;
  return (
    <div
      className="flex items-center justify-center gap-1 py-0.5 font-semibold"
      style={{ color: visual.accent }}
    >
      <Icon size={size === "small" ? 11 : 13} className="shrink-0" />
      <span className={size === "small" ? "text-[9px]" : "text-[10px]"}>{reason}</span>
    </div>
  );
}

function BlockDayLabels({
  labels,
  roleTag,
}: {
  labels: AvailabilityKind[];
  /**
   * Which department a collapsed resource is on that day. They keep one row
   * whatever their rules say, so this tag is all that is left of the rule —
   * it tells the scheduler where the person is without moving or hiding them.
   */
  roleTag?: string | null;
}) {
  if (labels.length === 0 && !roleTag) return null;
  return (
    <div className="flex flex-wrap gap-0.5 mb-0.5">
      {roleTag && (
        <span
          className="text-[8px] font-semibold leading-none px-0.5 py-px rounded bg-muted/20 text-muted"
          title={`Assigned to ${roleTag} this day`}
        >
          {roleTag}
        </span>
      )}
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
    calendarBlocks,
    updateAppointment,
  } = useData();
  useCurrentActor(); // keep hook call order stable
  useToast(); // keep hook call order stable
  // Auto-scroll the grid while dragging a tile toward its top/bottom edge so
  // off-screen crews become reachable as drop targets.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { draggedAppointment: activeDrag, draggedOrder: activeOrder, draggedMeta } = useSchedulerDrag();
  useDragAutoScroll(scrollRef, !!activeDrag || !!activeOrder);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [reschedulingAppt, setReschedulingAppt] = useState<Appointment | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    date: Date;
    crewId: string;
    timeBlock?: TimeBlock;
    prefill?: RForceOrder;
    startTime?: string;
    resourceHours?: number | null;
    isFullDay?: boolean;
  } | null>(null);
  // When dragging an existing appointment to a new crew/date, open modal for confirmation
  const [moveConfirmAppt, setMoveConfirmAppt] = useState<Appointment | null>(null);
  const [moveConfirmTarget, setMoveConfirmTarget] = useState<{
    date: Date;
    crewId: string;
    startTime?: string;
    endTime?: string;
    /** The row that was dropped on (e.g. the remote row), when the cell had one. */
    timeBlock?: TimeBlock;
  } | null>(null);

  // Sun–Sat week
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 }); // Sunday
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  // A resource appears in EVERY section their types cover. Role assignments no
  // longer move the row between sections — they block the off-role days, which
  // is resolved per crew per DAY below, not once for the focused date.
  const deptSections = useMemo(() => getDepartmentSections(crews), [crews]);

  const roleBlockFor = useCallback(
    (crew: Crew, sectionKey: string, day: Date) =>
      getCrewRoleBlock(crew, sectionKey, day, availabilityRules, availabilityExceptions),
    [availabilityRules, availabilityExceptions]
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

  // Why this crew can't be booked on this day, or null when they're workable.
  // The block grid never consulted availability rules at all before — it only
  // knew about external time off — so an Office day or a company holiday looked
  // like an ordinary open day here.
  const timeOffColor = getPreferences().time_off_color || undefined;
  const getDayBlock = useCallback(
    (crew: Crew, day: Date): { visual: BlockedVisual; reason: string } | null => {
      const dateStr = format(day, "yyyy-MM-dd");
      const names = offByDay.get(dateStr);
      const isOff =
        !!names &&
        (names.has(crew.name.toLowerCase()) ||
          (crew.aliases || []).some((a) => names.has(a.toLowerCase())));
      if (isOff) return { visual: timeOffVisual(timeOffColor), reason: "Time Off" };

      const avail = getCrewAvailability(
        crew.id,
        day,
        availabilityRules,
        availabilityExceptions,
        calendarBlocks || []
      );
      if (avail.available) return null;
      const visual = blockedVisualFor(avail.blockingKind, { timeOffColor });
      return { visual, reason: avail.reason || visual.label };
    },
    [offByDay, availabilityRules, availabilityExceptions, calendarBlocks, timeOffColor]
  );

  // Partially blocked windows (a 10-11 all-office meeting, a late start) so a
  // single measure row can be washed out without closing the whole day.
  const getBlockedSlots = useCallback(
    (crewId: string, day: Date) =>
      getCrewAvailability(
        crewId,
        day,
        availabilityRules,
        availabilityExceptions,
        calendarBlocks || []
      ),
    [availabilityRules, availabilityExceptions, calendarBlocks]
  );

  const getRoleTag = useCallback(
    (crew: Crew, day: Date) =>
      getCrewRoleTag(crew, day, availabilityRules, availabilityExceptions),
    [availabilityRules, availabilityExceptions]
  );

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
    key: string;
    title: string;
    crews: Crew[];
    rowMode: RowMode;
  }[] = [];

  if (filterType === "all" || filterType === "tech_measure") {
    if (measureCrews.length > 0)
      sections.push({ key: "measure", title: "MEASURES", crews: measureCrews, rowMode: "measure_blocks" });
  }
  if (filterType === "all" || filterType === "install") {
    if (installCrews.length > 0)
      sections.push({ key: "install", title: "INSTALLS", crews: installCrews, rowMode: "single" });
  }
  if (filterType === "all" || filterType === "jip") {
    if (jipCrews.length > 0)
      sections.push({ key: "jip", title: "JIPS/WOP", crews: jipCrews, rowMode: "hourly" });
  }
  if (filterType === "all" || filterType === "service") {
    if (serviceCrews.length > 0)
      sections.push({ key: "service", title: "SERVICE", crews: serviceCrews, rowMode: "hourly" });
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
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
              sectionKey={section.key}
              roleBlockFor={roleBlockFor}
              getRoleTag={getRoleTag}
              title={section.title}
              crews={section.crews}
              weekDays={weekDays}
              appointments={appointments}
              rowMode={section.rowMode}
              getDayBlock={getDayBlock}
              getBlockedSlots={getBlockedSlots}
              getDayLabels={getDayLabels}
              customerLastName={customerLastName}
              multiDayLabel={multiDayLabel}
              crewShortName={crewShortName}
              onAppointmentClick={setSelectedAppt}
              onQueueDrop={(order, crewId, day, block) => {
                const fullDay = draggedMeta?.fullDay ?? false;
                // A timed tile dropped into a block cell starts at that block's
                // time and runs for its queue-set hours.
                const blockStart =
                  !fullDay && block && block !== "full_day" ? timeBlockStartEnd(block).start : undefined;
                setScheduleTarget({
                  date: day,
                  crewId,
                  timeBlock: block,
                  prefill: order,
                  startTime: blockStart,
                  resourceHours: fullDay ? null : draggedMeta?.hours ?? null,
                  isFullDay: fullDay,
                });
              }}
              onAppointmentDrop={(draggedAppt, targetCrewId, targetDay, targetBlock) => {
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
                // A timed job (service/JIP) dropped onto a measure block row
                // starts at that block's time — the scheduler pointed at a slot
                // and expects it to land there. Only a drop with no block to aim
                // at falls back to stacking after the day's existing work.
                const isTimed = getSchedulingMode(appt.appointment_type) === "timed";
                const blockStart =
                  targetBlock && targetBlock !== "full_day" && targetBlock !== REMOTE_BLOCK
                    ? timeBlockStartEnd(targetBlock).start
                    : undefined;
                const nextStart = isTimed
                  ? blockStart ?? getNextAvailableStart(existingEndTimes, appt.appointment_type)
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
                  timeBlock: targetBlock,
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
          initialStartTime={scheduleTarget.startTime}
          initialResourceHours={scheduleTarget.resourceHours}
          initialIsFullDay={scheduleTarget.isFullDay}
          onClose={() => setScheduleTarget(null)}
        />
      )}

      {/* Confirmation modal for appointment drops — lets scheduler review/change the calculated time */}
      {moveConfirmAppt && moveConfirmTarget && (
        <ScheduleModal
          date={moveConfirmTarget.date}
          crewId={moveConfirmTarget.crewId}
          timeBlock={moveConfirmTarget.timeBlock}
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
  sectionKey: string;
  roleBlockFor: (crew: Crew, sectionKey: string, day: Date) => RoleBlock | null;
  getRoleTag: (crew: Crew, day: Date) => string | null;
  title: string;
  crews: Crew[];
  weekDays: Date[];
  appointments: Appointment[];
  rowMode: RowMode;
  getDayBlock: (crew: Crew, day: Date) => { visual: BlockedVisual; reason: string } | null;
  getBlockedSlots: (crewId: string, day: Date) => { unavailableBlocks: Set<TimeBlock> };
  getDayLabels: (crewId: string, day: Date) => AvailabilityKind[];
  customerLastName: (appt: Appointment) => string;
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  onQueueDrop?: (order: RForceOrder, crewId: string, day: Date, block?: TimeBlock) => void;
  onAppointmentDrop?: (appt: Appointment, targetCrewId: string, targetDay: Date, targetBlock?: TimeBlock) => void;
  today: Date;
}

function SectionBlock({
  sectionKey,
  roleBlockFor,
  getRoleTag,
  title,
  crews,
  weekDays,
  appointments,
  rowMode,
  getDayBlock,
  getBlockedSlots,
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
            sectionKey={sectionKey}
            roleBlockFor={roleBlockFor}
            getRoleTag={getRoleTag}
            crew={crew}
            weekDays={weekDays}
            appointments={appointments}
            getDayBlock={getDayBlock}
            getBlockedSlots={getBlockedSlots}
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
            sectionKey={sectionKey}
            roleBlockFor={roleBlockFor}
            getRoleTag={getRoleTag}
            crew={crew}
            weekDays={weekDays}
            appointments={appointments}
            getDayBlock={getDayBlock}
            getBlockedSlots={getBlockedSlots}
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
            sectionKey={sectionKey}
            roleBlockFor={roleBlockFor}
            getRoleTag={getRoleTag}
            crew={crew}
            weekDays={weekDays}
            appointments={appointments}
            getDayBlock={getDayBlock}
            getBlockedSlots={getBlockedSlots}
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
  sectionKey: string;
  roleBlockFor: (crew: Crew, sectionKey: string, day: Date) => RoleBlock | null;
  getRoleTag: (crew: Crew, day: Date) => string | null;
  crew: Crew;
  weekDays: Date[];
  appointments: Appointment[];
  getDayBlock: (crew: Crew, day: Date) => { visual: BlockedVisual; reason: string } | null;
  getBlockedSlots: (crewId: string, day: Date) => { unavailableBlocks: Set<TimeBlock> };
  getDayLabels: (crewId: string, day: Date) => AvailabilityKind[];
  customerLastName: (appt: Appointment) => string;
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  onQueueDrop?: (order: RForceOrder, crewId: string, day: Date, block?: TimeBlock) => void;
  onAppointmentDrop?: (appt: Appointment, targetCrewId: string, targetDay: Date, targetBlock?: TimeBlock) => void;
  today: Date;
}

function CrewRow({
  sectionKey,
  roleBlockFor,
  getRoleTag,
  crew,
  weekDays,
  appointments,
  getDayBlock,
  getBlockedSlots,
  getDayLabels,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  onQueueDrop,
  onAppointmentDrop,
  today,
}: CrewRowProps) {
  const { draggedOrder, draggedAppointment, setDraggedOrder, setDraggedAppointment } = useSchedulerDrag();
  const crewColor = crewColorFor(crew);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  // Live presence (visual-only): report/highlight the hovered crew×day.
  const { setHoveredCell, hoverColorFor } = usePresence();

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
        const dayBlock = getDayBlock(crew, day);
            const off = !!dayBlock;
        const dayKey = day.toISOString();
        const isDragOver = dragOverDay === dayKey;
        const presenceKey = `${crew.id}|${format(day, "yyyy-MM-dd")}`;
        const peerColor = hoverColorFor(presenceKey);
        const dayAppts = getAppointmentsForCrewAndDay(
          appointments,
          crew.id,
          day
        ).filter(a => a.status !== "cancelled" && a.status !== "unscheduled");
        // PTO takes precedence over Late/Office tags — hide them when off.
        const dayLabels = off ? [] : getDayLabels(crew.id, day);
        const roleBlock = roleBlockFor(crew, sectionKey, day);

        // Never collapse a day that has work on it — a booking must stay
        // visible in every section this resource appears in, or the grid
        // shows a free slot that is actually taken.
        if (roleBlock && dayAppts.length === 0) {
          return (
            <td
              key={dayKey}
              className={`border border-border p-0.5 align-middle text-center min-w-[120px] ${ROLE_BLOCKED_HATCH} ${isToday ? "bg-primary/5" : ""}`}
              style={peerColor ? { outline: `2px solid ${peerColor}`, outlineOffset: "-2px" } : undefined}
              title={`${crew.name} is assigned to ${roleBlock.label} on ${format(day, "EEEE")}`}
              onMouseEnter={() => setHoveredCell(presenceKey)}
              onMouseLeave={() => setHoveredCell(null)}
            >
              <BlockDayLabels labels={dayLabels} roleTag={getRoleTag(crew, day)} />
              <RoleBlockedCell label={roleBlock.label} />
            </td>
          );
        }

        return (
          <td
            key={dayKey}
            className={`border border-border p-0.5 align-top min-w-[120px] transition-colors ${
              isToday ? "bg-primary/5" : ""
            } ${roleBlock ? ROLE_BLOCKED_HATCH : ""} ${isDragOver ? "!bg-primary/10 outline outline-2 outline-dashed outline-primary" : ""}`}
            style={peerColor ? { outline: `2px solid ${peerColor}`, outlineOffset: "-2px" } : undefined}
            onMouseEnter={() => setHoveredCell(presenceKey)}
            onMouseLeave={() => setHoveredCell(null)}
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
            <BlockDayLabels labels={dayLabels} roleTag={getRoleTag(crew, day)} />
            {dayBlock ? (
              <BlockedMark visual={dayBlock.visual} reason={dayBlock.reason} />
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
                    foreign={isForeignToSection(appt, sectionKey)}
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
  sectionKey: string;
  roleBlockFor: (crew: Crew, sectionKey: string, day: Date) => RoleBlock | null;
  getRoleTag: (crew: Crew, day: Date) => string | null;
  crew: Crew;
  weekDays: Date[];
  appointments: Appointment[];
  getDayBlock: (crew: Crew, day: Date) => { visual: BlockedVisual; reason: string } | null;
  getBlockedSlots: (crewId: string, day: Date) => { unavailableBlocks: Set<TimeBlock> };
  getDayLabels: (crewId: string, day: Date) => AvailabilityKind[];
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  onQueueDrop?: (order: RForceOrder, crewId: string, day: Date, block?: TimeBlock) => void;
  onAppointmentDrop?: (appt: Appointment, targetCrewId: string, targetDay: Date, targetBlock?: TimeBlock) => void;
  today: Date;
}

function MeasureCrewRows({
  sectionKey,
  roleBlockFor,
  getRoleTag,
  crew,
  weekDays,
  appointments,
  getDayBlock,
  getBlockedSlots,
  getDayLabels,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  onQueueDrop,
  onAppointmentDrop,
  today,
}: MeasureCrewRowsProps) {
  const { draggedOrder, draggedAppointment, setDraggedOrder, setDraggedAppointment } = useSchedulerDrag();
  const crewColor = crewColorFor(crew);
  // "remote", then "9-10", "10-12", "12-2", "2-4", "4-6"
  const blocks = MEASURE_ROW_BLOCKS;
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  // Live presence (visual-only): report/highlight the hovered crew×day.
  const { setHoveredCell, hoverColorFor } = usePresence();

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
      const fullDay = dayAppts.filter(isAllDayWork);
      map.set(dateStr, fullDay);
    }
    return map;
  }, [dayApptsMap, weekDays]);

  return (
    <>
      {blocks.map((block, blockIdx) => (
        <tr key={`${crew.id}-${block}`} className={block === REMOTE_BLOCK ? "bg-muted/5" : ""}>
          {/* Crew name + time label — each row gets its own cell for alignment */}
          <td
            className={`border border-border p-1 whitespace-nowrap text-[11px] ${blockIdx === 0 ? "border-t" : "border-t-0"}`}
            style={{ borderLeft: `3px solid ${crewColor}` }}
            title={crew.name}
          >
            {blockIdx === 0 && (
              <div className="font-semibold">{crewShortName(crew)}</div>
            )}
            <div
              className={`text-[9px] font-normal ${block === REMOTE_BLOCK ? "text-muted/70 italic" : "text-muted"}`}
              title={block === REMOTE_BLOCK ? "Measures done remotely — no on-site time" : undefined}
            >
              {MEASURE_BLOCK_LABELS[block] || block}
            </div>
          </td>

          {weekDays.map((day) => {
            const isToday = isSameDay(day, today);
            const dayBlock = getDayBlock(crew, day);
            const off = !!dayBlock;
            const dateStr = format(day, "yyyy-MM-dd");
            const dayAppts = dayApptsMap.get(dateStr) || [];
            const presenceKey = `${crew.id}|${dateStr}`;
            const peerColor = hoverColorFor(presenceKey);
            const ringStyle = peerColor
              ? { outline: `2px solid ${peerColor}`, outlineOffset: "-2px" as const }
              : undefined;

            if (dayBlock) {
              if (blockIdx === 0) {
                return (
                  <td
                    key={day.toISOString()}
                    rowSpan={blocks.length}
                    className="border border-border p-0.5 text-center align-middle"
                    style={{ ...blockedCellStyle(dayBlock.visual), ...ringStyle }}
                    title={`${crew.name} — ${dayBlock.reason}`}
                    onMouseEnter={() => setHoveredCell(presenceKey)}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <BlockDayLabels labels={getDayLabels(crew.id, day)} roleTag={getRoleTag(crew, day)} />
                    <BlockedMark visual={dayBlock.visual} reason={dayBlock.reason} />
                  </td>
                );
              }
              return null;
            }

            // Cross-department work (a service, a JIP) carries a start/end
            // window and no time_block, so it has to be placed by overlap:
            // a 9–11 service occupies both the 9-10 and 10-12 rows.
            const blockAppts = dayAppts.filter(
              (a) => !isAllDayWork(a) && appointmentOccupiesBlock(a, block)
            );
            // Cross-type all-day work belongs on the first ON-SITE row, not in
            // the remote row above it.
            const fullDayAppts =
              block === MEASURE_TIME_BLOCKS[0] ? (fullDayByDay.get(dateStr) || []) : [];
            // Reserved by another department today (e.g. "SVC Mon–Wed"). The
            // row stays visible so the scheduler can see the person exists and
            // where they went — it just can't be booked from here.
            const roleBlock = roleBlockFor(crew, sectionKey, day);
            // Never collapse a day that has work on it — see CrewRow above.
            if (roleBlock && dayAppts.length === 0) {
              if (blockIdx === 0) {
                return (
                  <td
                    key={day.toISOString()}
                    rowSpan={blocks.length}
                    className={`border border-border p-0.5 text-center align-middle ${ROLE_BLOCKED_HATCH} ${isToday ? "bg-primary/5" : ""}`}
                    style={ringStyle}
                    title={`${crew.name} is assigned to ${roleBlock.label} on ${format(day, "EEEE")}`}
                    onMouseEnter={() => setHoveredCell(presenceKey)}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <BlockDayLabels labels={getDayLabels(crew.id, day)} roleTag={getRoleTag(crew, day)} />
                    <RoleBlockedCell label={roleBlock.label} />
                  </td>
                );
              }
              return null;
            }

            // Part of the day blocked (a 10-11 all-office meeting, a late
            // start): wash just the rows it covers rather than the column.
            const slotBlocked = getBlockedSlots(crew.id, day).unavailableBlocks.has(block)
              ? blockedVisualFor(undefined)
              : null;

            const cellKey = `${dateStr}-${block}`;
            const isDragOver = dragOverCell === cellKey;

            return (
              <td
                key={day.toISOString()}
                className={`border border-border/50 p-0.5 align-top text-[10px] transition-colors ${
                  isToday ? "bg-primary/5" : ""
                } ${roleBlock ? ROLE_BLOCKED_HATCH : ""} ${isDragOver ? "!bg-primary/10 outline outline-2 outline-dashed outline-primary" : ""}`}
                style={{ ...(slotBlocked ? blockedSlotStyle(slotBlocked) : undefined), ...ringStyle }}
                title={slotBlocked ? `${crew.name} is blocked this window` : undefined}
                onMouseEnter={() => setHoveredCell(presenceKey)}
                onMouseLeave={() => setHoveredCell(null)}
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
                    // Pass the row that was dropped on so the confirm modal opens
                    // on THAT block (including the remote row), not the tile's old one.
                    onAppointmentDrop?.(dragged.appointment, crew.id, day, block as TimeBlock);
                    setDraggedAppointment(null);
                  }
                }}
              >
                {blockIdx === 0 && <BlockDayLabels labels={getDayLabels(crew.id, day)} roleTag={getRoleTag(crew, day)} />}
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
                    foreign={isForeignToSection(appt, sectionKey)}
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
                    foreign={isForeignToSection(appt, sectionKey)}
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
  sectionKey: string;
  roleBlockFor: (crew: Crew, sectionKey: string, day: Date) => RoleBlock | null;
  getRoleTag: (crew: Crew, day: Date) => string | null;
  crew: Crew;
  weekDays: Date[];
  appointments: Appointment[];
  getDayBlock: (crew: Crew, day: Date) => { visual: BlockedVisual; reason: string } | null;
  getBlockedSlots: (crewId: string, day: Date) => { unavailableBlocks: Set<TimeBlock> };
  getDayLabels: (crewId: string, day: Date) => AvailabilityKind[];
  multiDayLabel: (appt: Appointment, day: Date) => string;
  crewShortName: (crew: Crew) => string;
  onAppointmentClick: (appt: Appointment) => void;
  onQueueDrop?: (order: RForceOrder, crewId: string, day: Date, block?: TimeBlock) => void;
  onAppointmentDrop?: (appt: Appointment, targetCrewId: string, targetDay: Date, targetBlock?: TimeBlock) => void;
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
  sectionKey,
  roleBlockFor,
  getRoleTag,
  crew,
  weekDays,
  appointments,
  getDayBlock,
  getBlockedSlots,
  getDayLabels,
  multiDayLabel,
  crewShortName,
  onAppointmentClick,
  onQueueDrop,
  onAppointmentDrop,
  today,
}: HourlyCrewRowsProps) {
  const { draggedOrder, draggedAppointment, setDraggedOrder, setDraggedAppointment } = useSchedulerDrag();
  const crewColor = crewColorFor(crew);
  const hours = SERVICE_HOURS;
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  // Live presence (visual-only): report/highlight the hovered crew×day.
  const { setHoveredCell, hoverColorFor } = usePresence();

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
            const dayBlock = getDayBlock(crew, day);
            const off = !!dayBlock;
            const dateStr = format(day, "yyyy-MM-dd");
            const presenceKey = `${crew.id}|${dateStr}`;
            const peerColor = hoverColorFor(presenceKey);
            const ringStyle = peerColor
              ? { outline: `2px solid ${peerColor}`, outlineOffset: "-2px" as const }
              : undefined;

            if (dayBlock) {
              if (hourIdx === 0) {
                return (
                  <td
                    key={day.toISOString()}
                    rowSpan={hours.length}
                    className="border border-border p-0.5 text-center align-middle"
                    style={{ ...blockedCellStyle(dayBlock.visual), ...ringStyle }}
                    title={`${crew.name} — ${dayBlock.reason}`}
                    onMouseEnter={() => setHoveredCell(presenceKey)}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <BlockDayLabels labels={getDayLabels(crew.id, day)} roleTag={getRoleTag(crew, day)} />
                    <BlockedMark visual={dayBlock.visual} reason={dayBlock.reason} />
                  </td>
                );
              }
              return null;
            }

            // Reserved by another department today — row stays, cell is closed.
            const roleBlock = roleBlockFor(crew, sectionKey, day);
            // Never collapse a day that has work on it — see CrewRow above.
            if (roleBlock && (dayApptsMap.get(dateStr) || []).length === 0) {
              if (hourIdx === 0) {
                return (
                  <td
                    key={day.toISOString()}
                    rowSpan={hours.length}
                    className={`border border-border p-0.5 text-center align-middle ${ROLE_BLOCKED_HATCH} ${isToday ? "bg-primary/5" : ""}`}
                    style={ringStyle}
                    title={`${crew.name} is assigned to ${roleBlock.label} on ${format(day, "EEEE")}`}
                    onMouseEnter={() => setHoveredCell(presenceKey)}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <BlockDayLabels labels={getDayLabels(crew.id, day)} roleTag={getRoleTag(crew, day)} />
                    <RoleBlockedCell label={roleBlock.label} />
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
                } ${roleBlock ? ROLE_BLOCKED_HATCH : ""} ${isDragOver ? "!bg-primary/10 outline outline-2 outline-dashed outline-primary" : ""}`}
                style={ringStyle}
                onMouseEnter={() => setHoveredCell(presenceKey)}
                onMouseLeave={() => setHoveredCell(null)}
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
                {hourIdx === 0 && <BlockDayLabels labels={getDayLabels(crew.id, day)} roleTag={getRoleTag(crew, day)} />}
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
                        foreign={isForeignToSection(appt, sectionKey)}
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
  /**
   * Out-of-department work shown on a multi-department resource's row. Drawn in
   * a neutral "not this department" style so the slot reads as taken by another
   * desk — but fully editable, because for a collapsed resource this row is the
   * ONLY place the job appears.
   */
  foreign?: boolean;
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
  foreign,
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

  const typeName = typeLabel(appointment.appointment_type);

  return (
    <div
      draggable
      onClick={onClick}
      tabIndex={0}
      aria-label={
        foreign
          ? `Open ${appointment.customer_name} ${typeName} appointment (other department)`
          : `Open ${appointment.customer_name} appointment`
      }
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
      className={`group/block relative rounded px-1.5 truncate transition-shadow cursor-grab active:cursor-grabbing hover:shadow-sm ${
        foreign
          ? `border border-dashed border-muted/50 text-muted ${ROLE_BLOCKED_HATCH}`
          : "text-white"
      } ${small ? "py-0 text-[10px] leading-snug" : "py-0.5 text-[11px] leading-tight"}`}
      style={{
        backgroundColor: foreign ? undefined : crewColor,
        minHeight: heightRows && heightRows > 1 ? `${heightRows * 20}px` : undefined,
      }}
      title={
        foreign
          ? `${typeName} — ${appointment.customer_name} (another department's work)`
          : `${appointment.customer_name} — ${appointment.address || ""} (${typeName})`
      }
    >
      {foreign && (
        <span className="text-[8px] font-bold tracking-wide mr-1 px-0.5 rounded bg-muted/25">
          {foreignTypeBadge(appointment)}
        </span>
      )}
      <span className={foreign ? "" : "pr-3"}>{label}</span>
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
