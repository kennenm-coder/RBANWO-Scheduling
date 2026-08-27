"use client";

import { useState, useMemo, useRef, Fragment } from "react";
import { useData } from "./DataProvider";
import AppointmentCard from "./AppointmentCard";
import RForceCard from "./RForceCard";
import ApprovalCard from "./ApprovalCard";
import DiscrepancyBadge from "./DiscrepancyBadge";
import AppointmentSheet from "./AppointmentSheet";
import RForceDetailSheet from "./RForceDetailSheet";
import ScheduleModal from "./ScheduleModal";
import {
  Appointment,
  Crew,
  RForceOrder,
  TimeBlock,
  AppointmentType,
  RForceDisplayItem,
  AvailabilityKind,
} from "@/lib/types";
import {
  getWeekDays,
  getAppointmentsForCrewAndDay,
  getRForceDisplayItems,
  MEASURE_TIME_BLOCKS,
  timeBlockStartEnd,
  appointmentSpansBlock,
  formatAppointmentTimeRange,
} from "@/lib/calendar-utils";
import { deriveRForceCalendarStatus } from "@/lib/rforce-calendar-status";
import { getTimeOffForDate } from "@/lib/store";
import { executeScheduleMove, ScheduleMoveTarget } from "@/lib/schedule-command";
import OverlapOverrideDialog from "./OverlapOverrideDialog";
import { useCurrentActor } from "./AuthProvider";
import { getDepartmentSectionsForDate, isDualRole, getBlockedTimeBlocks, parseCity, crewHasType } from "@/lib/crew-utils";
import { appointmentMatchesSearch, rforceItemMatchesSearch } from "@/lib/search-utils";
import { getPreferences, crewColorFor } from "@/lib/preferences";
import { usePresence } from "@/lib/presence";
import { format, isToday, parseISO, addDays } from "date-fns";
import { Plus, Palmtree, ChevronDown, ChevronRight, Unlink, Ban, AlertTriangle } from "lucide-react";
import { useSchedulerDrag } from "@/lib/drag-context";
import { useDragAutoScroll } from "@/lib/use-drag-autoscroll";
import { getSchedulingMode } from "@/lib/scheduling-policy";
import { useToast } from "./Toast";
import { getAllCrewsAvailabilityForWeek, CrewDayAvailability, getCrewDayLabels, LABEL_KIND_TEXT, labelForBlockingKind } from "@/lib/availability";

interface Props {
  currentDate: Date;
  onDayClick: (date: Date) => void;
  filterType?: AppointmentType | "all";
  searchQuery?: string;
  showRForce?: boolean;
}

const SHORT_BLOCK_LABELS: Record<string, string> = {
  "9-10": "9–10a",
  "10-12": "10–12",
  "12-2": "12–2p",
  "2-4": "2–4p",
  "4-6": "4–6p",
};

export default function CrewLaneWeekView({
  currentDate,
  onDayClick,
  filterType = "all",
  searchQuery = "",
  showRForce = false,
}: Props) {
  const {
    crews, appointments, rforceOrders, timeOffRequests,
    availabilityRules, availabilityExceptions, activeLinks,
    resourceMappings, dismissals, updateAppointment,
    approveRForce, dismissRForce, exportDates,
  } = useData();
  const { showToast } = useToast();
  const { actorId, actorName } = useCurrentActor();

  const days = getWeekDays(currentDate);
  // Auto-scroll the grid while dragging a tile toward its top/bottom edge so
  // off-screen crews become reachable as drop targets.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { draggedAppointment: activeDrag, draggedOrder: activeOrder, draggedMeta } = useSchedulerDrag();
  useDragAutoScroll(scrollRef, !!activeDrag || !!activeOrder);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [reschedulingAppt, setReschedulingAppt] = useState<Appointment | null>(null);
  const [dropConfirmTarget, setDropConfirmTarget] = useState<{
    appointment: Appointment;
    date: string;
    crewId: string;
  } | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    date: Date;
    crewId: string;
    timeBlock?: TimeBlock;
    prefill?: RForceOrder;
    resourceHours?: number | null;
    isFullDay?: boolean;
  } | null>(null);
  // A drop/resize that hit an occupied slot, awaiting confirmation to overlap.
  const [pendingOverlap, setPendingOverlap] = useState<{
    target: ScheduleMoveTarget;
    appt: Appointment;
    message: string;
    successMessage: string;
  } | null>(null);
  // A drop onto a blocked availability window (PTO / Late / Office), awaiting
  // confirmation to schedule over it.
  const [pendingAvailability, setPendingAvailability] = useState<{
    target: ScheduleMoveTarget;
    appt: Appointment;
    message: string;
    successMessage: string;
  } | null>(null);
  const [selectedRForce, setSelectedRForce] = useState<{
    order: RForceOrder;
    crew?: Crew;
    displayItem?: RForceDisplayItem;
  } | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const prefs = useMemo(() => getPreferences(), []);
  const timeOffColor = prefs.time_off_color || undefined;

  const offByDay = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const day of days) {
      const dateStr = format(day, "yyyy-MM-dd");
      const offToday = getTimeOffForDate(timeOffRequests, dateStr);
      const names = new Set<string>();
      for (const r of offToday) {
        names.add(r.employee_name.toLowerCase());
      }
      map.set(dateStr, names);
    }
    return map;
  }, [days, timeOffRequests]);

  const crewAvailability = useMemo(() => {
    const crewIds = crews.filter((c) => c.is_active).map((c) => c.id);
    return getAllCrewsAvailabilityForWeek(crewIds, days[0], availabilityRules, availabilityExceptions);
  }, [crews, days, availabilityRules, availabilityExceptions]);

  const rforceByDay = useMemo(() => {
    const map = new Map<string, RForceDisplayItem[]>();
    for (const day of days) {
      map.set(
        format(day, "yyyy-MM-dd"),
        getRForceDisplayItems(rforceOrders, appointments, activeLinks, crews, day, dismissals, resourceMappings, exportDates)
      );
    }
    return map;
  }, [days, rforceOrders, appointments, activeLinks, crews, dismissals, resourceMappings, exportDates]);

  // New rForce adapter — derives mismatch status for linked appointments
  const rforceStatusByWO = useMemo(() => {
    const items = deriveRForceCalendarStatus(rforceOrders, appointments, activeLinks, crews, resourceMappings);
    const map = new Map<string, boolean>();
    for (const item of items) {
      if (item.status === "mismatch") {
        map.set(item.rforceOrder.work_order_number.trim().toLowerCase(), true);
      }
    }
    return map;
  }, [rforceOrders, appointments, activeLinks, crews, resourceMappings]);

  function hasMismatch(appt: Appointment): boolean {
    if (!appt.work_order_number) return false;
    return rforceStatusByWO.get(appt.work_order_number.trim().toLowerCase()) === true;
  }

  function nameMatchesDay(name: string, dateStr: string): boolean {
    const offNames = offByDay.get(dateStr);
    if (!offNames) return false;
    const lower = name.toLowerCase();
    if (offNames.has(lower)) return true;
    const first = lower.split(" ")[0];
    const last = lower.split(" ").slice(-1)[0];
    const offToday = getTimeOffForDate(timeOffRequests, dateStr);
    for (const r of offToday) {
      const torFirst = r.employee_name.split(" ")[0].toLowerCase();
      const torLast = r.employee_name.split(" ").slice(-1)[0].toLowerCase();
      if (first === torFirst && last.slice(0, 4) === torLast.slice(0, 4)) return true;
    }
    return false;
  }

  function isCrewOffOnDay(crew: Crew, day: Date): boolean {
    const dateStr = format(day, "yyyy-MM-dd");
    if (nameMatchesDay(crew.name, dateStr)) return true;
    if (crew.aliases) {
      for (const alias of crew.aliases) {
        if (nameMatchesDay(alias, dateStr)) return true;
      }
    }
    return false;
  }

  function getMultiDayLabel(appt: Appointment, day: Date): string | null {
    if (appt.duration_days <= 1 || !appt.scheduled_date) return null;
    const startDate = parseISO(appt.scheduled_date);
    const endDate = addDays(startDate, appt.duration_days - 1);
    const dayStr = format(day, "yyyy-MM-dd");
    const startStr = appt.scheduled_date;
    if (dayStr === startStr) {
      return `${format(startDate, "M/d")}–${format(endDate, "M/d")}`;
    }
    return null;
  }

  // Use date-aware sections so role_assignment rules (e.g. SVC M/W/F)
  // move crews to the correct department for the current week's start day.
  // For week view, we use the currentDate (the focused day) to determine
  // role placement — crews appear in their role for that day.
  const sections = useMemo(
    () => getDepartmentSectionsForDate(crews, currentDate, availabilityRules, availabilityExceptions),
    [crews, currentDate, availabilityRules, availabilityExceptions]
  );

  const filteredSections = useMemo(() => {
    if (filterType === "all") return sections;
    return sections.filter((s) => s.filterType === filterType);
  }, [sections, filterType]);

  // Same-time appointments (and rForce cards) render as side-by-side lanes. A
  // day column has to widen to fit the busiest slot in that day across every
  // crew, so all rows in the column share one width. Compute that lane count.
  const dayColumnLanes = useMemo(() => {
    const lanes = new Map<string, number>();
    for (const day of days) lanes.set(format(day, "yyyy-MM-dd"), 1);
    for (const section of filteredSections) {
      if (collapsedSections.has(section.key)) continue;
      const isMeasure = section.filterType === "tech_measure" && !section.key.includes("mgmt");
      for (const crew of section.crews) {
        const showTimeLanes = isMeasure || (isDualRole(crew) && crewHasType(crew, "measure_tech"));
        for (const day of days) {
          const dateStr = format(day, "yyyy-MM-dd");
          const cellAppts = getAppointmentsForCrewAndDay(appointments, crew.id, day);
          const items = (rforceByDay.get(dateStr) || []).filter((r) => r.crewId === crew.id);
          const approvals = items.filter((d) => d.displayMode === "approval");
          const visible = items.filter((d) => d.displayMode === "synced" || d.displayMode === "regular" || d.displayMode === "discrepancy");
          let cellMax = 1;
          if (showTimeLanes) {
            for (const block of MEASURE_TIME_BLOCKS) {
              const ba = cellAppts.filter((a) => appointmentSpansBlock(a, block)).length;
              const br =
                approvals.filter((r) => r.timeBlock === block).length +
                (showRForce ? visible.filter((r) => r.timeBlock === block).length : 0);
              cellMax = Math.max(cellMax, ba + br);
            }
          } else {
            // Standard cells stack every card vertically (including same-start
            // groups), so the column never has to widen — one lane is enough.
            cellMax = 1;
          }
          lanes.set(dateStr, Math.max(lanes.get(dateStr) || 1, cellMax));
        }
      }
    }
    return lanes;
  }, [filteredSections, collapsedSections, days, appointments, rforceByDay, showRForce]);

  const LANE_BASE_PX = 120;
  const LANE_EXTRA_PX = 104;
  const gridTemplateColumns = useMemo(
    () =>
      "140px " +
      days
        .map((day) => {
          const n = dayColumnLanes.get(format(day, "yyyy-MM-dd")) || 1;
          return `minmax(${LANE_BASE_PX + (Math.max(n, 1) - 1) * LANE_EXTRA_PX}px, 1fr)`;
        })
        .join(" "),
    [days, dayColumnLanes]
  );

  function toggleSection(key: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleAppointmentDrop(
    appointmentId: string,
    _sourceCrewId: string,
    _sourceDate: string,
    _sourceTimeBlock: TimeBlock | null,
    targetCrewId: string,
    targetDate: string,
    targetTimeBlock: TimeBlock | null
  ) {
    const appt = appointments.find((a) => a.id === appointmentId);
    if (!appt) return;

    // A generic Week cell does not communicate an exact time. Timed work must
    // be reviewed rather than silently receiving a default or stale time.
    if (targetTimeBlock === null && getSchedulingMode(appt.appointment_type) === "timed") {
      setDropConfirmTarget({ appointment: appt, date: targetDate, crewId: targetCrewId });
      return;
    }

    const targetCrew = crews.find((c) => c.id === targetCrewId);
    await runMove(
      {
        appointmentId: appt.id,
        expectedVersion: appt.version,
        crewId: targetCrewId,
        scheduledDate: targetDate,
        timeBlock: targetTimeBlock,
        startTime: appt.start_time,
        endTime: appt.end_time,
      },
      appt,
      `Moved to ${targetCrew?.name || "crew"} on ${targetDate}`
    );
  }

  // Run a move; on a slot conflict, stash it so the scheduler can confirm an
  // intentional overlap (retries with allowOverlap). `override` is set only by
  // that confirmation path.
  async function runMove(
    target: ScheduleMoveTarget,
    appt: Appointment,
    successMessage: string,
    override = false,
    availabilityOverride = false
  ) {
    const result = await executeScheduleMove(
      { ...target, allowOverlap: override, allowAvailabilityConflict: availabilityOverride },
      appt,
      appointments,
      crews,
      rforceOrders,
      updateAppointment,
      { id: actorId, name: actorName },
      availabilityRules,
      availabilityExceptions
    );

    if (result.ok) {
      showToast(successMessage, "success");
    } else if (result.error.code === "SCHEDULING_CONFLICT" && !override) {
      setPendingOverlap({ target, appt, message: result.error.message, successMessage });
    } else if (result.error.code === "AVAILABILITY_CONFLICT" && !availabilityOverride) {
      setPendingAvailability({ target, appt, message: result.error.message, successMessage });
    } else {
      const severity = result.error.code === "VERSION_CONFLICT" ? "warning" : "error";
      showToast(result.error.message, severity);
    }
  }

  async function handleResizeDrop(appointmentId: string, targetBlock: TimeBlock) {
    const appt = appointments.find((a) => a.id === appointmentId);
    if (!appt || !appt.time_block) return;

    const startIdx = MEASURE_TIME_BLOCKS.indexOf(appt.time_block);
    const targetIdx = MEASURE_TIME_BLOCKS.indexOf(targetBlock);
    if (startIdx < 0 || targetIdx < 0) return;

    const newEnd = targetIdx > startIdx ? targetBlock : null;
    if (newEnd === (appt.time_block_end || null)) return;

    if (newEnd) {
      const dateStr = appt.scheduled_date;
      for (let i = startIdx; i <= targetIdx; i++) {
        const block = MEASURE_TIME_BLOCKS[i];
        if (block === appt.time_block) continue;
        const conflict = appointments.find(
          (a) => a.id !== appt.id && a.status !== "cancelled" && a.crew_id === appt.crew_id && a.scheduled_date === dateStr && appointmentSpansBlock(a, block)
        );
        if (conflict) {
          showToast(`Cannot extend — ${MEASURE_TIME_BLOCKS[i]} is occupied`, "error");
          return;
        }
      }
    }

    const endTimes = newEnd ? timeBlockStartEnd(newEnd) : timeBlockStartEnd(appt.time_block);

    try {
      const result = await executeScheduleMove(
        {
          appointmentId: appt.id,
          expectedVersion: appt.version,
          crewId: appt.crew_id!,
          scheduledDate: appt.scheduled_date!,
          timeBlock: appt.time_block,
          timeBlockEnd: newEnd,
          startTime: appt.start_time,
          endTime: endTimes.end,
          additionalUpdates: { end_time: endTimes.end },
          auditAction: "drag_resized",
        },
        appt,
        appointments,
        crews,
        rforceOrders,
        updateAppointment,
        { id: actorId, name: actorName }
      );
      if (!result.ok) throw new Error(result.error.message);
      showToast(newEnd ? `Extended to ${newEnd}` : "Shrunk to single block", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      showToast(`Failed to resize: ${msg}`, "error");
    }
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
      <div
        className="grid min-w-[1120px]"
        style={{ gridTemplateColumns }}
      >
        {/* Sticky header row — shared across all departments */}
        <div className="h-5 flex items-center px-1 text-[9px] text-muted font-medium text-left border-b border-border sticky left-0 top-0 bg-background z-40">
          Crew
        </div>
        {days.map((day) => {
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className={`h-5 flex items-center justify-center gap-1 px-0.5 text-[9px] font-medium text-center border-b border-border cursor-pointer hover:bg-primary-light sticky top-0 bg-background z-30 ${today ? "bg-primary-light" : ""}`}
              onClick={() => onDayClick(day)}
            >
              <span className={today ? "text-primary font-bold" : ""}>
                {format(day, "EEE")}
              </span>{" "}
              <span className="text-muted">{format(day, "M/d")}</span>
            </div>
          );
        })}

        {/* Department sections — all share the same column geometry */}
        {filteredSections.map((section) => {
          const isCollapsed = collapsedSections.has(section.key);
          const isMeasure = section.filterType === "tech_measure" && !section.key.includes("mgmt");

          let sectionJobCount = 0;
          let sectionConflictCount = 0;
          for (const crew of section.crews) {
            for (const day of days) {
              const cellAppts = getAppointmentsForCrewAndDay(appointments, crew.id, day);
              sectionJobCount += cellAppts.length;
              const dateStr = format(day, "yyyy-MM-dd");
              const dayRForce = rforceByDay.get(dateStr) || [];
              sectionJobCount += dayRForce.filter((r) => r.crewId === crew.id && (r.displayMode === "approval" || (showRForce && (r.displayMode === "regular" || r.displayMode === "synced")))).length;
              if (isCrewOffOnDay(crew, day) && cellAppts.length > 0) {
                sectionConflictCount++;
              }
            }
          }

          return (
            <Fragment key={section.key}>
              {/* Section header — spans all 8 columns */}
              <button
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center gap-1.5 px-2 py-1 bg-surface sticky top-5 z-20 hover:bg-border/50 transition-colors"
                style={{ gridColumn: '1 / -1' }}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                  {section.title}
                </span>
                <span className="text-[9px] text-muted">
                  {sectionJobCount}
                </span>
                {sectionConflictCount > 0 && (
                  <span className="text-[9px] bg-danger text-white px-1 rounded-full">
                    {sectionConflictCount}
                  </span>
                )}
              </button>

              {/* Crew rows — each crew occupies 1 grid row (name cell + 7 day cells) */}
              {!isCollapsed && section.crews.map((crew) => {
                const showTimeLanes = isMeasure || (isDualRole(crew) && crewHasType(crew, "measure_tech"));

                return (
                  <Fragment key={crew.id}>
                    {/* Crew name cell — sticky left */}
                    <div className="px-1 py-0.5 text-[10px] font-medium border-b border-border sticky left-0 bg-background z-[5]">
                      <div className="flex items-center gap-1">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: crewColorFor(crew) }}
                        />
                        <span className="truncate leading-tight">{crew.name}</span>
                      </div>
                    </div>
                    {/* 7 day cells */}
                    {days.map((day) => {
                      const off = isCrewOffOnDay(crew, day);
                      const cellAppts = getAppointmentsForCrewAndDay(appointments, crew.id, day);
                      const dateStr = format(day, "yyyy-MM-dd");
                      const dayItems = rforceByDay.get(dateStr) || [];
                      const cellDisplayItems = dayItems.filter((r) => r.crewId === crew.id);
                      const hasConflict = off && cellAppts.length > 0;
                      const crewObj = crews.find((c) => c.id === crew.id);
                      const dayAvail = crewAvailability.get(crew.id)?.get(dateStr);
                      // Suppress Late/Office badges when the crew is off for PTO —
                      // PTO takes precedence over the Late Day / Office Day tag.
                      const dayLabels = off
                        ? []
                        : getCrewDayLabels(crew.id, day, availabilityRules, availabilityExceptions);

                      if (showTimeLanes) {
                        const blockedFromOtherSections = !isMeasure
                          ? getBlockedTimeBlocks(crew.id, appointments, dateStr)
                          : new Set<TimeBlock>();

                        return (
                          <MeasureTimeLaneCell
                            key={day.toISOString()}
                            crew={crew}
                            day={day}
                            off={off}
                            hasConflict={hasConflict}
                            cellAppts={cellAppts}
                            cellDisplayItems={cellDisplayItems}
                            rforceOrders={rforceOrders}
                            searchQuery={searchQuery}
                            crewObj={crewObj}
                            blockedBlocks={blockedFromOtherSections}
                            sectionType={section.filterType}
                            timeOffColor={timeOffColor}
                            availability={dayAvail}
                            dayLabels={dayLabels}
                            showRForce={showRForce}
                            onCardClick={setSelectedAppt}
                            onRForceClick={(order, item) => setSelectedRForce({ order, crew: crewObj, displayItem: item })}
                            onSchedule={(block) =>
                              setScheduleTarget({ date: day, crewId: crew.id, timeBlock: block })
                            }
                            getMultiDayLabel={getMultiDayLabel}
                            onAppointmentDrop={(apptId, srcCrewId, srcDate, srcBlock, targetBlock) =>
                              handleAppointmentDrop(apptId, srcCrewId, srcDate, srcBlock, crew.id, format(day, "yyyy-MM-dd"), targetBlock)
                            }
                            onResizeDrop={handleResizeDrop}
                            onQueueDrop={(order) =>
                              setScheduleTarget({
                                date: day,
                                crewId: crew.id,
                                prefill: order,
                                resourceHours: draggedMeta?.fullDay ? null : draggedMeta?.hours ?? null,
                                isFullDay: draggedMeta?.fullDay ?? false,
                              })
                            }
                            onApproveRForce={approveRForce}
                            onDismissRForce={dismissRForce}
                            hasMismatch={hasMismatch}
                          />
                        );
                      }

                      return (
                        <StandardCell
                          key={day.toISOString()}
                          crew={crew}
                          day={day}
                          off={off}
                          hasConflict={hasConflict}
                          cellAppts={cellAppts}
                          cellDisplayItems={cellDisplayItems}
                          rforceOrders={rforceOrders}
                          searchQuery={searchQuery}
                          crewObj={crewObj}
                          timeOffColor={timeOffColor}
                          availability={dayAvail}
                          dayLabels={dayLabels}
                          showRForce={showRForce}
                          onCardClick={setSelectedAppt}
                          onRForceClick={(order, item) => setSelectedRForce({ order, crew: crewObj, displayItem: item })}
                          onSchedule={() =>
                            setScheduleTarget({ date: day, crewId: crew.id })
                          }
                          getMultiDayLabel={getMultiDayLabel}
                          onDrop={(order) =>
                            setScheduleTarget({
                              date: day,
                              crewId: crew.id,
                              prefill: order,
                              resourceHours: draggedMeta?.fullDay ? null : draggedMeta?.hours ?? null,
                              isFullDay: draggedMeta?.fullDay ?? false,
                            })
                          }
                          onAppointmentDrop={(apptId, srcCrewId, srcDate, srcBlock) =>
                            handleAppointmentDrop(apptId, srcCrewId, srcDate, srcBlock, crew.id, format(day, "yyyy-MM-dd"), null)
                          }
                          onApproveRForce={approveRForce}
                          onDismissRForce={dismissRForce}
                          hasMismatch={hasMismatch}
                        />
                      );
                    })}
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      </div>

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

      {selectedRForce && (
        <RForceDetailSheet
          order={selectedRForce.order}
          crew={selectedRForce.crew}
          stale={selectedRForce.displayItem?.stale}
          onClose={() => setSelectedRForce(null)}
          onApprove={
            selectedRForce.displayItem?.displayMode === "approval"
              ? async (override?: boolean) => {
                  const item = selectedRForce.displayItem!;
                  const dateStr = selectedRForce.order.scheduled_start?.slice(0, 10) || format(new Date(), "yyyy-MM-dd");
                  await approveRForce(selectedRForce.order, item.crewId, item.timeBlock, dateStr, override);
                }
              : undefined
          }
          onDismiss={
            selectedRForce.displayItem?.displayMode === "approval"
              ? async () => {
                  const dateStr = selectedRForce.order.scheduled_start?.slice(0, 10) || format(new Date(), "yyyy-MM-dd");
                  await dismissRForce(selectedRForce.order.work_order_number, dateStr, selectedRForce.order.scheduled_start?.slice(11, 16));
                }
              : undefined
          }
        />
      )}

      {editingAppt && (
        <ScheduleModal
          date={editingAppt.scheduled_date ? new Date(editingAppt.scheduled_date) : new Date()}
          editingAppointment={editingAppt}
          onClose={() => setEditingAppt(null)}
        />
      )}

      {reschedulingAppt && (
        <ScheduleModal
          date={reschedulingAppt.scheduled_date ? new Date(reschedulingAppt.scheduled_date) : new Date()}
          editingAppointment={reschedulingAppt}
          rescheduleMode
          onClose={() => setReschedulingAppt(null)}
        />
      )}

      {scheduleTarget && (
        <ScheduleModal
          date={scheduleTarget.date}
          crewId={scheduleTarget.crewId}
          timeBlock={scheduleTarget.timeBlock}
          prefill={scheduleTarget.prefill}
          initialResourceHours={scheduleTarget.resourceHours}
          initialIsFullDay={scheduleTarget.isFullDay}
          onClose={() => setScheduleTarget(null)}
        />
      )}

      {dropConfirmTarget && (
        <ScheduleModal
          date={new Date(`${dropConfirmTarget.date}T00:00:00`)}
          crewId={dropConfirmTarget.crewId}
          editingAppointment={dropConfirmTarget.appointment}
          rescheduleMode
          onClose={() => setDropConfirmTarget(null)}
        />
      )}

      {pendingOverlap && (
        <OverlapOverrideDialog
          message={pendingOverlap.message}
          onConfirm={async () => {
            const p = pendingOverlap;
            await runMove(p.target, p.appt, p.successMessage, true);
            setPendingOverlap(null);
          }}
          onCancel={() => setPendingOverlap(null)}
        />
      )}

      {pendingAvailability && (
        <OverlapOverrideDialog
          title="Crew is blocked off"
          intro="This lands on a blocked window:"
          checkboxLabel="Yes, schedule over this block on purpose."
          message={pendingAvailability.message}
          onConfirm={async () => {
            const p = pendingAvailability;
            await runMove(p.target, p.appt, p.successMessage, false, true);
            setPendingAvailability(null);
          }}
          onCancel={() => setPendingAvailability(null)}
        />
      )}
    </div>
  );
}

function DayLabelBadges({ labels }: { labels?: AvailabilityKind[] }) {
  if (!labels || labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5 px-0.5 pt-0.5">
      {labels.map((k) => (
        <span
          key={k}
          className={`text-[7px] font-semibold leading-none px-0.5 py-px rounded ${
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

function MeasureTimeLaneCell({
  crew,
  day,
  off,
  hasConflict,
  cellAppts,
  cellDisplayItems,
  rforceOrders,
  searchQuery,
  crewObj,
  blockedBlocks,
  sectionType,
  timeOffColor,
  availability,
  dayLabels,
  showRForce,
  onCardClick,
  onRForceClick,
  onSchedule,
  getMultiDayLabel,
  onAppointmentDrop,
  onResizeDrop,
  onQueueDrop,
  onApproveRForce,
  onDismissRForce,
  hasMismatch,
}: {
  crew: Crew;
  day: Date;
  off: boolean;
  hasConflict: boolean;
  cellAppts: Appointment[];
  cellDisplayItems: RForceDisplayItem[];
  rforceOrders: RForceOrder[];
  searchQuery: string;
  crewObj: Crew | undefined;
  blockedBlocks: Set<TimeBlock>;
  sectionType: string;
  timeOffColor?: string;
  availability?: CrewDayAvailability;
  dayLabels?: AvailabilityKind[];
  showRForce?: boolean;
  onCardClick: (a: Appointment) => void;
  onRForceClick: (order: RForceOrder, displayItem?: RForceDisplayItem) => void;
  onSchedule: (block: TimeBlock) => void;
  getMultiDayLabel: (a: Appointment, d: Date) => string | null;
  onAppointmentDrop?: (apptId: string, srcCrewId: string, srcDate: string, srcBlock: TimeBlock | null, targetBlock: TimeBlock) => void;
  onResizeDrop?: (apptId: string, targetBlock: TimeBlock) => void;
  onQueueDrop?: (order: RForceOrder) => void;
  onApproveRForce?: (order: RForceOrder, crewId: string, tb: TimeBlock, date: string, override?: boolean) => Promise<Appointment | null>;
  onDismissRForce?: (workOrderNumber: string, rforceDate: string, startTime?: string) => Promise<void>;
  hasMismatch: (appt: Appointment) => boolean;
}) {
  const {
    draggedAppointment,
    draggedOrder,
    resizingAppointment,
    setDraggedAppointment,
    setDraggedOrder,
    setResizingAppointment,
  } = useSchedulerDrag();
  const [blockDragOver, setBlockDragOver] = useState<TimeBlock | null>(null);
  const [cellDragOver, setCellDragOver] = useState(false);
  const dateStr = format(day, "yyyy-MM-dd");

  const rforceByWo = useMemo(() => {
    const map = new Map<string, RForceOrder>();
    for (const rf of rforceOrders) map.set(rf.work_order_number, rf);
    return map;
  }, [rforceOrders]);

  const allApptsSorted = [...cellAppts].sort((a, b) => {
    const blockOrder = MEASURE_TIME_BLOCKS as string[];
    const aIdx = a.time_block ? blockOrder.indexOf(a.time_block) : 99;
    const bIdx = b.time_block ? blockOrder.indexOf(b.time_block) : 99;
    return aIdx - bIdx;
  });
  // Appointments that don't land in ANY 2-hour block — a timed service/JIP or a
  // full-day job assigned to this measure tech. They MUST still be shown or a
  // scheduler could book over an appointment they can't see.
  const offBlockAppts = allApptsSorted.filter(
    (a) => !MEASURE_TIME_BLOCKS.some((b) => appointmentSpansBlock(a, b))
  );

  const approvalItems = cellDisplayItems.filter((d) => d.displayMode === "approval");
  const discrepancyItems = cellDisplayItems.filter((d) => d.displayMode === "discrepancy");
  const visibleRForce = cellDisplayItems.filter((d) =>
    d.displayMode === "synced" || d.displayMode === "regular" || d.displayMode === "discrepancy"
  );
  const allRForceSorted = [...(showRForce ? visibleRForce : []), ...approvalItems].sort((a, b) => {
    const blockOrder = MEASURE_TIME_BLOCKS as string[];
    return blockOrder.indexOf(a.timeBlock) - blockOrder.indexOf(b.timeBlock);
  });
  const discrepancyByApptId = new Map<string, RForceDisplayItem>();
  for (const d of discrepancyItems) {
    if (d.linkedAppointment) discrepancyByApptId.set(d.linkedAppointment.id, d);
  }

  const offStyle = timeOffColor
    ? { backgroundColor: `${timeOffColor}15` }
    : undefined;
  const offBorderStyle = timeOffColor
    ? { borderColor: `${timeOffColor}60` }
    : undefined;

  function handleCellDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setCellDragOver(true);
  }
  function handleCellDragLeave() {
    setCellDragOver(false);
  }
  function handleCellDrop(e: React.DragEvent) {
    e.preventDefault();
    setCellDragOver(false);
    setBlockDragOver(null);
    const draggedAppt = draggedAppointment;
    if (draggedAppt) {
      onAppointmentDrop?.(draggedAppt.appointment.id, draggedAppt.sourceCrewId, draggedAppt.sourceDate, draggedAppt.sourceTimeBlock, MEASURE_TIME_BLOCKS[0]);
      setDraggedAppointment(null);
      return;
    }
    const order = draggedOrder;
    if (order) {
      onQueueDrop?.(order);
      setDraggedOrder(null);
    }
  }

  return (
    <div
      className={`p-0 border-b border-border border-l border-l-border/30 ${
        hasConflict
          ? "bg-time-off-conflict/10"
          : off
            ? (timeOffColor ? "" : "bg-time-off-light/60")
            : ""
      } ${cellDragOver ? "outline outline-2 outline-dashed outline-primary bg-primary/10" : ""}`}
      style={off && !hasConflict && timeOffColor ? offStyle : hasConflict && timeOffColor ? { backgroundColor: `${timeOffColor}20` } : undefined}
      onDragOver={handleCellDragOver}
      onDragLeave={handleCellDragLeave}
      onDrop={handleCellDrop}
    >
      <DayLabelBadges labels={dayLabels} />
      {hasConflict && (
        <div className="text-[8px] font-semibold px-0.5 flex items-center gap-0.5" style={timeOffColor ? { color: timeOffColor } : undefined}>
          <Palmtree size={8} style={timeOffColor ? { color: timeOffColor } : undefined} className={timeOffColor ? "" : "text-time-off"} />
          <span className={timeOffColor ? "" : "text-time-off-conflict"}>OFF</span>
        </div>
      )}
      {off && cellAppts.length === 0 && allRForceSorted.length === 0 && discrepancyItems.length === 0 && (
        <div
          className={`w-full h-5 flex items-center justify-center rounded-sm border border-dashed ${timeOffColor ? "" : "bg-time-off-light/40 border-time-off/40"}`}
          style={timeOffColor ? { ...offStyle, ...offBorderStyle } : undefined}
        >
          <Palmtree size={9} style={timeOffColor ? { color: `${timeOffColor}90` } : undefined} className={timeOffColor ? "" : "text-time-off/50"} />
        </div>
      )}
      {/* Cross-type jobs (timed service/JIP, full-day) on this measure tech that
          match no block — shown at the top so they can't hide behind the grid. */}
      {offBlockAppts.length > 0 && (
        <div className="space-y-0.5 px-0.5 pt-0.5">
          {offBlockAppts.map((a) => {
            const dimmed = !!searchQuery && !appointmentMatchesSearch(a, crewObj, searchQuery);
            const discItem = discrepancyByApptId.get(a.id);
            return (
              <div key={a.id} className="relative">
                <WeekCard
                  dimmed={dimmed}
                  onClick={() => onCardClick(a)}
                  appointment={a}
                  sourceCrewId={crew.id}
                  sourceDate={dateStr}
                  sourceTimeBlock={a.time_block}
                >
                  <CompactAppointmentContent
                    appointment={a}
                    crew={crewObj}
                    hasDiscrepancy={!!discItem || hasMismatch(a)}
                    multiDayLabel={getMultiDayLabel(a, day)}
                    orderAlerts={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.order_alerts || rforceByWo.get(a.work_order_number)?.scheduler_notes || null) : null}
                    accountName={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.account_name || null) : null}
                    showRForce={showRForce}
                  />
                </WeekCard>
                {discItem && <DiscrepancyBadge differences={discItem.differences} onClick={() => onRForceClick(discItem.rforceOrder, discItem)} />}
              </div>
            );
          })}
        </div>
      )}
      {(!off || cellAppts.length > 0 || allRForceSorted.length > 0 || discrepancyItems.length > 0) && (
        <div>
          {MEASURE_TIME_BLOCKS.map((block) => {
            const isBlocked = blockedBlocks.has(block);
            const isUnavailable = availability ? availability.unavailableBlocks.has(block) : false;
            const blockAppts = allApptsSorted.filter((a) => appointmentSpansBlock(a, block));
            const blockRForce = allRForceSorted.filter((r) => r.timeBlock === block);
            const hasItems = blockAppts.length > 0 || blockRForce.length > 0;
            const isFromOtherSection = isBlocked && !hasItems;
            const isDropTarget = blockDragOver === block;

            function handleBlockDragOver(e: React.DragEvent) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setBlockDragOver(block);
            }
            function handleBlockDragLeave() {
              setBlockDragOver(null);
            }
            function handleBlockDrop(e: React.DragEvent) {
              e.preventDefault();
              e.stopPropagation();
              setBlockDragOver(null);
              const resizing = resizingAppointment;
              if (resizing) {
                onResizeDrop?.(resizing.appointmentId, block);
                setResizingAppointment(null);
                return;
              }
              const draggedAppt = draggedAppointment;
              if (draggedAppt) {
                onAppointmentDrop?.(draggedAppt.appointment.id, draggedAppt.sourceCrewId, draggedAppt.sourceDate, draggedAppt.sourceTimeBlock, block);
                setDraggedAppointment(null);
                return;
              }
              const order = draggedOrder;
              if (order) {
                onQueueDrop?.(order);
                setDraggedOrder(null);
              }
            }

            return (
              <div
                key={block}
                className={`flex items-stretch min-h-[18px] border-b border-border/20 last:border-b-0 ${isDropTarget ? "outline outline-2 outline-dashed outline-primary bg-primary/10" : ""}`}
                onDragOver={handleBlockDragOver}
                onDragLeave={handleBlockDragLeave}
                onDrop={handleBlockDrop}
              >
                <div className="w-[32px] shrink-0 text-[7px] text-muted flex items-center justify-center bg-surface/30 leading-none">
                  {SHORT_BLOCK_LABELS[block] || block}
                </div>
                <div className="flex-1 min-w-0 px-0.5">
                  {isFromOtherSection ? (
                    <div className="h-full min-h-[18px] rounded-sm bg-surface/60 flex items-center justify-center">
                      <span className="text-[7px] text-muted/50">booked</span>
                    </div>
                  ) : isUnavailable && !hasItems ? (
                    <div className="h-full min-h-[18px] rounded-sm bg-muted/8 flex items-center justify-center">
                      <span className="text-[7px] text-muted/40">off</span>
                    </div>
                  ) : hasItems ? (
                    // Each rForce card and each appointment is its own side-by-side
                    // lane; the day column is pre-sized to fit the busiest block.
                    <div className="flex items-start gap-0.5">
                      {blockRForce.filter((rf) => rf.displayMode !== "approval").map((rf) => {
                        const dimmed = !!searchQuery && !rforceItemMatchesSearch(rf, crewObj, searchQuery);
                        return (
                          <div key={`rf-${rf.rforceOrder.work_order_number}`} className="flex-1 min-w-0">
                            <WeekCard dimmed={dimmed} onClick={() => onRForceClick(rf.rforceOrder, rf)}>
                              <CompactRForceContent order={rf.rforceOrder} crew={crewObj} isSynced={rf.displayMode === "synced"} />
                            </WeekCard>
                          </div>
                        );
                      })}
                      {blockRForce.filter((rf) => rf.displayMode === "approval").map((rf) => (
                        <div key={`approve-${rf.rforceOrder.work_order_number}`} className="flex-1 min-w-0">
                          <ApprovalCard
                            rforceOrder={rf.rforceOrder}
                            stale={rf.stale} dropTier={rf.dropTier}
                            crew={crewObj}
                            compact
                            onApprove={async (override) => {
                              await onApproveRForce?.(rf.rforceOrder, crew.id, rf.timeBlock, dateStr, override);
                            }}
                            onDismiss={() =>
                              onDismissRForce?.(rf.rforceOrder.work_order_number, dateStr, rf.rforceOrder.scheduled_start?.slice(11, 16)) ?? Promise.resolve()
                            }
                            onClick={() => onRForceClick(rf.rforceOrder, rf)}
                          />
                        </div>
                      ))}
                      {blockAppts.map((a) => {
                        const isSpanStart = a.time_block === block;
                        if (!isSpanStart && a.time_block_end) return null;
                        const dimmed = !!searchQuery && !appointmentMatchesSearch(a, crewObj, searchQuery);
                        const multiDay = getMultiDayLabel(a, day);
                        const spanLen = a.time_block_end ? MEASURE_TIME_BLOCKS.indexOf(a.time_block_end) - MEASURE_TIME_BLOCKS.indexOf(a.time_block!) + 1 : 1;
                        const discItem = discrepancyByApptId.get(a.id);
                        return (
                          <div key={a.id} className="relative flex-1 min-w-0">
                            <WeekCard
                              dimmed={dimmed}
                              onClick={() => onCardClick(a)}
                              appointment={a}
                              sourceCrewId={crew.id}
                              sourceDate={dateStr}
                              sourceTimeBlock={block}
                              spanBlocks={spanLen}
                              showResizeHandle={true}
                            >
                              <CompactAppointmentContent
                                appointment={a}
                                crew={crewObj}
                                hasDiscrepancy={!!discItem || hasMismatch(a)}
                                multiDayLabel={multiDay}
                                orderAlerts={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.order_alerts || rforceByWo.get(a.work_order_number)?.scheduler_notes || null) : null}
                                accountName={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.account_name || null) : null}
                                showRForce={showRForce}
                              />
                            </WeekCard>
                            {discItem && <DiscrepancyBadge differences={discItem.differences} onClick={() => onRForceClick(discItem.rforceOrder, discItem)} />}
                          </div>
                        );
                      })}
                      {/* Only show + button if no app appointments occupy this block */}
                      {blockAppts.length === 0 && (
                        <button
                          onClick={() => onSchedule(block)}
                          className="flex-1 min-w-0 h-3 flex items-center justify-center hover:bg-primary-light/30 transition-colors"
                        >
                          <Plus size={7} className="text-muted/20 hover:text-primary" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => onSchedule(block)}
                      className="w-full h-full min-h-[18px] flex items-center justify-center hover:bg-primary-light/30 transition-colors"
                    >
                      <Plus size={7} className="text-muted/15" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StandardCell({
  crew,
  day,
  off,
  hasConflict,
  cellAppts,
  cellDisplayItems,
  rforceOrders,
  searchQuery,
  crewObj,
  timeOffColor,
  availability,
  dayLabels,
  showRForce,
  onCardClick,
  onSchedule,
  onRForceClick,
  getMultiDayLabel,
  onDrop,
  onAppointmentDrop,
  onApproveRForce,
  onDismissRForce,
  hasMismatch,
}: {
  crew: Crew;
  day: Date;
  off: boolean;
  hasConflict: boolean;
  cellAppts: Appointment[];
  cellDisplayItems: RForceDisplayItem[];
  rforceOrders: RForceOrder[];
  searchQuery: string;
  crewObj: Crew | undefined;
  timeOffColor?: string;
  availability?: CrewDayAvailability;
  dayLabels?: AvailabilityKind[];
  showRForce?: boolean;
  onCardClick: (a: Appointment) => void;
  onSchedule: () => void;
  onRForceClick: (order: RForceOrder, displayItem?: RForceDisplayItem) => void;
  getMultiDayLabel: (a: Appointment, d: Date) => string | null;
  onDrop?: (order: RForceOrder) => void;
  onAppointmentDrop?: (apptId: string, srcCrewId: string, srcDate: string, srcBlock: TimeBlock | null) => void;
  onApproveRForce?: (order: RForceOrder, crewId: string, tb: TimeBlock, date: string, override?: boolean) => Promise<Appointment | null>;
  onDismissRForce?: (workOrderNumber: string, rforceDate: string, startTime?: string) => Promise<void>;
  hasMismatch: (appt: Appointment) => boolean;
}) {
  const { draggedAppointment, draggedOrder, setDraggedAppointment, setDraggedOrder } = useSchedulerDrag();
  const [dragOver, setDragOver] = useState(false);
  const dateStr = format(day, "yyyy-MM-dd");

  // Live presence (visual-only): report the hovered cell and highlight a cell a
  // peer is hovering. Never affects data or drag behavior.
  const { setHoveredCell, hoverColorFor } = usePresence();
  const presenceCellKey = `${crew.id}|${dateStr}`;
  const peerColor = hoverColorFor(presenceCellKey);
  const presenceHandlers = {
    onMouseEnter: () => setHoveredCell(presenceCellKey),
    onMouseLeave: () => setHoveredCell(null),
  };
  const ringStyle = peerColor
    ? { outline: `2px solid ${peerColor}`, outlineOffset: "-2px" as const }
    : undefined;

  const approvalItems = cellDisplayItems.filter((d) => d.displayMode === "approval");
  const discrepancyItems = cellDisplayItems.filter((d) => d.displayMode === "discrepancy");
  const visibleRForce = showRForce
    ? cellDisplayItems.filter((d) => d.displayMode === "synced" || d.displayMode === "regular" || d.displayMode === "discrepancy")
    : [];
  const discrepancyByApptId = new Map<string, RForceDisplayItem>();
  for (const d of discrepancyItems) {
    if (d.linkedAppointment) discrepancyByApptId.set(d.linkedAppointment.id, d);
  }

  const hasContent = cellAppts.length > 0 || approvalItems.length > 0 || visibleRForce.length > 0 || discrepancyItems.length > 0;
  const crewUnavailable = availability ? !availability.available : false;

  const rforceByWo = useMemo(() => {
    const map = new Map<string, RForceOrder>();
    for (const rf of rforceOrders) map.set(rf.work_order_number, rf);
    return map;
  }, [rforceOrders]);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const draggedAppt = draggedAppointment;
    if (draggedAppt) {
      onAppointmentDrop?.(draggedAppt.appointment.id, draggedAppt.sourceCrewId, draggedAppt.sourceDate, draggedAppt.sourceTimeBlock);
      setDraggedAppointment(null);
      return;
    }
    const order = draggedOrder;
    if (order && onDrop) {
      onDrop(order);
      setDraggedOrder(null);
    }
  }

  const sortedAppts = [...cellAppts].sort((a, b) =>
    (a.start_time || "08:00").localeCompare(b.start_time || "08:00")
  );

  const offStyle = timeOffColor
    ? { backgroundColor: `${timeOffColor}15` }
    : undefined;
  const offBorderStyle = timeOffColor
    ? { borderColor: `${timeOffColor}60` }
    : undefined;

  // Stack cards vertically by start time; only cards sharing an exact start
  // time render side-by-side in one row. Untimed (e.g. full-day) cards sort
  // last. This mirrors the day view's top-to-bottom-by-time read order.
  const startTimeGroups = (() => {
    const groups = new Map<string, React.ReactNode[]>();
    const push = (time: string, node: React.ReactNode) => {
      const key = time || "~~";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(node);
    };

    for (const rf of visibleRForce) {
      const dimmed = !!searchQuery && !rforceItemMatchesSearch(rf, crewObj, searchQuery);
      const time = rf.rforceOrder.scheduled_start?.slice(11, 16) || timeBlockStartEnd(rf.timeBlock).start;
      push(time, (
        <div key={`rf-${rf.rforceOrder.work_order_number}`} className="flex-1 min-w-0">
          <WeekCard dimmed={dimmed} onClick={() => onRForceClick(rf.rforceOrder, rf)}>
            <CompactRForceContent order={rf.rforceOrder} crew={crewObj} isSynced={rf.displayMode === "synced"} />
          </WeekCard>
        </div>
      ));
    }

    for (const rf of approvalItems) {
      const time = rf.rforceOrder.scheduled_start?.slice(11, 16) || timeBlockStartEnd(rf.timeBlock).start;
      push(time, (
        <div key={`approve-${rf.rforceOrder.work_order_number}`} className="flex-1 min-w-0">
          <ApprovalCard
            rforceOrder={rf.rforceOrder}
            stale={rf.stale} dropTier={rf.dropTier}
            crew={crewObj}
            compact
            onApprove={async (override) => {
              await onApproveRForce?.(rf.rforceOrder, crew.id, rf.timeBlock, dateStr, override);
            }}
            onDismiss={async () => {
              await onDismissRForce?.(rf.rforceOrder.work_order_number, dateStr, rf.rforceOrder.scheduled_start?.slice(11, 16));
            }}
            onClick={() => onRForceClick(rf.rforceOrder, rf)}
          />
        </div>
      ));
    }

    for (const a of sortedAppts) {
      const dimmed = !!searchQuery && !appointmentMatchesSearch(a, crewObj, searchQuery);
      const multiDay = getMultiDayLabel(a, day);
      const discItem = discrepancyByApptId.get(a.id);
      const time = a.start_time || (a.time_block ? timeBlockStartEnd(a.time_block).start : "");
      push(time, (
        <div key={a.id} className="relative flex-1 min-w-0">
          <WeekCard
            dimmed={dimmed}
            onClick={() => onCardClick(a)}
            appointment={a}
            sourceCrewId={crew.id}
            sourceDate={dateStr}
            sourceTimeBlock={a.time_block}
          >
            <CompactAppointmentContent
              appointment={a}
              crew={crewObj}
              hasDiscrepancy={!!discItem || hasMismatch(a)}
              multiDayLabel={multiDay}
              orderAlerts={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.order_alerts || rforceByWo.get(a.work_order_number)?.scheduler_notes || null) : null}
              accountName={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.account_name || null) : null}
            />
          </WeekCard>
          {discItem && <DiscrepancyBadge differences={discItem.differences} onClick={() => onRForceClick(discItem.rforceOrder, discItem)} />}
        </div>
      ));
    }

    return [...groups.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  })();

  if (off && !hasContent) {
    return (
      <div
        className={`p-0.5 border-b border-border border-l border-l-border/30 ${timeOffColor ? "" : "bg-time-off-light/40"} ${dragOver ? "outline outline-2 outline-dashed outline-primary bg-primary/10" : ""}`}
        style={{ ...(timeOffColor ? offStyle : undefined), ...ringStyle }}
        {...presenceHandlers}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <DayLabelBadges labels={dayLabels} />
        <div
          className={`w-full h-6 rounded-sm flex items-center justify-center border border-dashed ${timeOffColor ? "" : "bg-time-off-light/30 border-time-off/40"}`}
          style={timeOffColor ? { ...offStyle, ...offBorderStyle } : undefined}
        >
          <Palmtree size={10} style={timeOffColor ? { color: `${timeOffColor}90` } : undefined} className={timeOffColor ? "" : "text-time-off/50"} />
        </div>
      </div>
    );
  }

  if (crewUnavailable && !hasContent) {
    const bk = availability?.blockingKind;
    const isLate = bk === "late_day";
    const isOffice = bk === "office_day";
    const isLabelBlock = isLate || isOffice;
    // Office/Late full-day blocks get their own colored, labeled tile (teal /
    // amber); PTO/Unavailable keep the neutral Ban tile.
    const wrapCls = isLate
      ? "bg-amber-50 dark:bg-amber-900/20"
      : isOffice
        ? "bg-teal-50 dark:bg-teal-900/20"
        : "bg-muted/5";
    const tileCls = isLate
      ? "bg-amber-100/60 dark:bg-amber-900/30 border-amber-300/50 dark:border-amber-700/40 text-amber-700 dark:text-amber-300"
      : isOffice
        ? "bg-teal-100/60 dark:bg-teal-900/30 border-teal-300/50 dark:border-teal-700/40 text-teal-700 dark:text-teal-300"
        : "bg-muted/5 border-muted/20 text-muted/40";
    return (
      <div
        className={`p-0.5 border-b border-border border-l border-l-border/30 ${wrapCls} ${dragOver ? "outline outline-2 outline-dashed outline-primary bg-primary/10" : ""}`}
        style={ringStyle}
        {...presenceHandlers}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* colored tile already carries the label; skip the small badge to avoid duplication */}
        {!isLabelBlock && <DayLabelBadges labels={dayLabels} />}
        <div className={`w-full h-6 rounded-sm flex items-center justify-center gap-1 border border-dashed ${tileCls}`}>
          {isLabelBlock ? (
            <span className="text-[8px] font-semibold leading-none">
              {labelForBlockingKind(bk)}
            </span>
          ) : (
            <Ban size={9} className="text-muted/30" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`p-0.5 border-b border-border border-l border-l-border/30 ${
        hasConflict
          ? (timeOffColor ? "" : "bg-time-off-conflict/10")
          : off
            ? (timeOffColor ? "" : "bg-time-off-light/40")
            : ""
      } ${dragOver ? "outline outline-2 outline-dashed outline-primary bg-primary/10" : ""}`}
      style={{
        ...(hasConflict && timeOffColor
          ? { backgroundColor: `${timeOffColor}20` }
          : off && timeOffColor
            ? offStyle
            : undefined),
        ...ringStyle,
      }}
      {...presenceHandlers}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <DayLabelBadges labels={dayLabels} />
      {hasConflict && (
        <div className="text-[8px] font-semibold px-0.5 flex items-center gap-0.5">
          <Palmtree size={8} style={timeOffColor ? { color: timeOffColor } : undefined} className={timeOffColor ? "" : "text-time-off"} />
          <span style={timeOffColor ? { color: timeOffColor } : undefined} className={timeOffColor ? "" : "text-time-off-conflict"}>OFF</span>
        </div>
      )}
      {hasContent ? (
        // Every card stacks vertically by start time; cards sharing an exact
        // start time also stack (one over the other) rather than sitting
        // side-by-side. The + row sits at the bottom.
        <div className="space-y-0.5">
          {startTimeGroups.map(([key, nodes]) => (
            <div key={key} className="flex flex-col gap-0.5">
              {nodes}
            </div>
          ))}
          <button
            onClick={onSchedule}
            className="w-full h-3 flex items-center justify-center hover:bg-primary-light/30 transition-colors rounded-sm"
          >
            <Plus size={7} className="text-muted/15 hover:text-primary" />
          </button>
        </div>
      ) : (
        <button
          onClick={onSchedule}
          className="w-full h-6 rounded-sm border border-dashed border-border/20 hover:border-primary hover:bg-primary-light/30 transition-colors flex items-center justify-center group"
        >
          <Plus size={8} className="text-muted/15 group-hover:text-primary" />
        </button>
      )}
    </div>
  );
}

function WeekCard({
  children,
  dimmed,
  onClick,
  appointment,
  sourceCrewId,
  sourceDate,
  sourceTimeBlock,
  spanBlocks,
  showResizeHandle,
}: {
  children: React.ReactNode;
  dimmed?: boolean;
  onClick: () => void;
  appointment?: Appointment;
  sourceCrewId?: string;
  sourceDate?: string;
  sourceTimeBlock?: TimeBlock | null;
  spanBlocks?: number;
  showResizeHandle?: boolean;
}) {
  const { setDraggedAppointment, setResizingAppointment } = useSchedulerDrag();
  const isDraggable = !!appointment;
  const spanHeight = spanBlocks && spanBlocks > 1 ? { height: `${spanBlocks * 18}px`, position: "relative" as const, zIndex: 5 } : undefined;

  function handleDragStart(e: React.DragEvent) {
    if (!appointment || !sourceCrewId || !sourceDate) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", appointment.id);
    setDraggedAppointment({
      appointment,
      sourceCrewId,
      sourceDate,
      sourceTimeBlock: sourceTimeBlock ?? null,
    });
    (e.currentTarget as HTMLElement).style.opacity = "0.4";
  }

  function handleDragEnd(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).style.opacity = "1";
    setDraggedAppointment(null);
  }

  function handleResizeDragStart(e: React.DragEvent) {
    e.stopPropagation();
    if (!appointment || !appointment.time_block) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `resize:${appointment.id}`);
    const img = document.createElement("canvas");
    img.width = 1;
    img.height = 1;
    e.dataTransfer.setDragImage(img, 0, 0);
    setResizingAppointment({
      appointmentId: appointment.id,
      originalTimeBlock: appointment.time_block,
    });
  }

  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onDragEnd={isDraggable ? handleDragEnd : undefined}
      onClick={onClick}
      tabIndex={0}
      aria-label="Open appointment details"
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={`rounded-sm cursor-pointer hover:shadow transition-all text-[9px] leading-tight overflow-hidden group/card ${
        dimmed ? "opacity-30" : ""
      } ${isDraggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={spanHeight}
    >
      {children}
      {showResizeHandle && appointment?.time_block && (
        <div
          draggable
          onDragStart={handleResizeDragStart}
          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-s-resize opacity-0 group-hover/card:opacity-100 hover:bg-white/30 transition-opacity"
        />
      )}
    </div>
  );
}

function CompactAppointmentContent({
  appointment,
  crew,
  hasDiscrepancy,
  multiDayLabel,
  orderAlerts,
  accountName,
  showRForce,
}: {
  appointment: Appointment;
  crew?: Crew;
  hasDiscrepancy: boolean;
  multiDayLabel: string | null;
  orderAlerts?: string | null;
  accountName?: string | null;
  showRForce?: boolean;
}) {
  const bgColor = crewColorFor(crew);
  const city = parseCity(appointment.address);
  const isLinked = !!appointment.work_order_number;
  // Parse additional crew members from notes
  const additionalMembers = appointment.notes?.match(/^\[Resources: ([^\]]*)\]/)?.[1] || "";
  const hasHelpers = !!(appointment.secondary_crew_id || appointment.tertiary_crew_id || additionalMembers);

  return (
    <div
      className={`rounded-sm px-1 py-0.5 text-white ${hasDiscrepancy ? "border-l-[3px] border-amber-400" : ""}`}
      style={{ backgroundColor: bgColor }}
    >
      {hasDiscrepancy && (
        <div className="truncate text-amber-200 text-[8px] font-semibold leading-tight flex items-center gap-0.5">
          <AlertTriangle size={8} className="shrink-0" />
          rF mismatch
        </div>
      )}
      {orderAlerts && (
        <div className="truncate text-yellow-200 text-[8px] leading-tight">{orderAlerts}</div>
      )}
      <div className="font-semibold truncate flex items-center gap-0.5">
        {appointment.customer_name}
        {appointment.manual_override && (
          <span className="text-blue-200 text-[8px] font-bold" title="Manual override">M</span>
        )}
        {showRForce && (
          isLinked ? (
            !hasDiscrepancy && (
              <span className="text-green-300 text-[8px]" title="In sync with rForce">&#10003;</span>
            )
          ) : (
            <span title="Not linked to rForce"><Unlink size={8} className="shrink-0 opacity-60" /></span>
          )
        )}
      </div>
      {formatAppointmentTimeRange(appointment) && (
        <div className="truncate font-medium opacity-95 text-[8px] leading-tight">
          {formatAppointmentTimeRange(appointment)}
        </div>
      )}
      {accountName && <div className="truncate opacity-70 text-[8px]">{accountName}</div>}
      {city && <div className="truncate opacity-80 text-[9px]">{city}</div>}
      {hasHelpers && (
        <div className="truncate opacity-80 text-[8px] flex items-center gap-0.5">
          <span>+{[
            ...(appointment.secondary_crew_id ? ["crew2"] : []),
            ...(appointment.tertiary_crew_id ? ["crew3"] : []),
            ...(additionalMembers ? [additionalMembers] : []),
          ].join(", ")}</span>
        </div>
      )}
      {multiDayLabel && (
        <div className="opacity-70 text-[9px]">{multiDayLabel}</div>
      )}
    </div>
  );
}

function CompactRForceContent({
  order,
  crew,
  isSynced,
}: {
  order: RForceOrder;
  crew?: Crew;
  isSynced?: boolean;
}) {
  const borderColor = crewColorFor(crew, "#888");
  const city = parseCity(order.address || "");

  return (
    <div
      className="rounded-sm px-1 py-0.5 border border-dashed"
      style={{ borderColor, backgroundColor: `${borderColor}15` }}
    >
      {order.order_alerts && (
        <div className="truncate text-amber-600 dark:text-amber-400 text-[8px] leading-tight">⚠ {order.order_alerts}</div>
      )}
      <div className="font-semibold truncate flex items-center gap-0.5 text-foreground/80 text-[9px]">
        {order.customer_name || "Unknown"}
        <span
          className="text-[6px] font-normal ml-auto px-0.5 rounded"
          style={{ backgroundColor: `${borderColor}30`, color: borderColor }}
        >
          {isSynced ? "rF ✓" : "rF"}
        </span>
      </div>
      {order.account_name && <div className="truncate text-foreground/50 text-[7px]">{order.account_name}</div>}
      {city && <div className="truncate text-foreground/60 text-[8px]">{city}</div>}
    </div>
  );
}
