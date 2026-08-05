"use client";

import { useState, useMemo } from "react";
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
} from "@/lib/types";
import {
  getWeekDays,
  getAppointmentsForCrewAndDay,
  getRForceDisplayItems,
  checkDiscrepancy,
  MEASURE_TIME_BLOCKS,
  timeBlockLabel,
} from "@/lib/calendar-utils";
import { getTimeOffForDate } from "@/lib/store";
import { getDepartmentSections, isDualRole, getBlockedTimeBlocks } from "@/lib/crew-utils";
import { parseCity, crewHasType } from "@/lib/crew-utils";
import { appointmentMatchesSearch, rforceItemMatchesSearch } from "@/lib/search-utils";
import { getPreferences } from "@/lib/preferences";
import { format, isToday, parseISO, addDays } from "date-fns";
import { Plus, Palmtree, ChevronDown, ChevronRight, Unlink } from "lucide-react";
import { getDraggedOrder, setDraggedOrder, getDraggedAppointment, setDraggedAppointment, getResizingAppointment, setResizingAppointment } from "@/lib/drag-context";
import { getEligibleCrews } from "@/lib/crew-utils";
import { timeBlockStartEnd, appointmentSpansBlock } from "@/lib/calendar-utils";
import { updateAppointment as updateApptInDb, createAppointmentEvent } from "@/lib/store";
import { useToast } from "./Toast";
import { getAllCrewsAvailabilityForWeek, isTimeBlockAvailable, CrewDayAvailability } from "@/lib/availability";
import { Ban } from "lucide-react";

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
    approveRForce, dismissRForce,
  } = useData();
  const { showToast } = useToast();

  const days = getWeekDays(currentDate);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [reschedulingAppt, setReschedulingAppt] = useState<Appointment | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    date: Date;
    crewId: string;
    timeBlock?: TimeBlock;
    prefill?: RForceOrder;
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
        getRForceDisplayItems(rforceOrders, appointments, activeLinks, crews, day, dismissals, resourceMappings)
      );
    }
    return map;
  }, [days, rforceOrders, appointments, activeLinks, crews, dismissals, resourceMappings]);

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
    if (appt.duration_days <= 1) return null;
    const startDate = parseISO(appt.scheduled_date);
    const endDate = addDays(startDate, appt.duration_days - 1);
    const dayStr = format(day, "yyyy-MM-dd");
    const startStr = appt.scheduled_date;
    if (dayStr === startStr) {
      return `${format(startDate, "M/d")}–${format(endDate, "M/d")}`;
    }
    return null;
  }

  const sections = useMemo(() => getDepartmentSections(crews), [crews]);

  const filteredSections = useMemo(() => {
    if (filterType === "all") return sections;
    return sections.filter((s) => s.filterType === filterType);
  }, [sections, filterType]);

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

    if (appt.crew_id === targetCrewId && appt.scheduled_date === targetDate && appt.time_block === targetTimeBlock) return;

    const targetCrew = crews.find((c) => c.id === targetCrewId);
    if (!targetCrew) return;

    const eligible = getEligibleCrews(crews, appt.appointment_type);
    if (!eligible.find((c) => c.id === targetCrewId)) {
      showToast(`${targetCrew.name} cannot handle ${appt.appointment_type.replace(/_/g, " ")} appointments`, "error");
      return;
    }

    const existing = appointments.filter(
      (a) => a.id !== appt.id && a.status !== "cancelled" && a.crew_id === targetCrewId && a.scheduled_date === targetDate
    );
    if (targetTimeBlock && targetTimeBlock !== "full_day") {
      const conflict = existing.find((a) => a.time_block === targetTimeBlock);
      if (conflict) {
        showToast(`${targetCrew.name} already has an appointment in that time block`, "error");
        return;
      }
    }

    const times = targetTimeBlock ? timeBlockStartEnd(targetTimeBlock) : { start: "08:00", end: "17:00" };

    let manualOverride = appt.manual_override;
    let overrideSource = appt.override_source;

    if (appt.work_order_number) {
      const rf = rforceOrders.find((r) => r.work_order_number === appt.work_order_number);
      if (rf && rf.scheduled_start) {
        const rfDate = rf.scheduled_start.slice(0, 10);
        const rfResource = rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
        if (targetDate !== rfDate || (rfResource && targetCrew.name.toLowerCase() !== rfResource.toLowerCase())) {
          manualOverride = true;
          overrideSource = {
            crew_name: rfResource || undefined,
            scheduled_date: rfDate,
            time_block: appt.time_block || undefined,
          };
        } else {
          manualOverride = false;
          overrideSource = null;
        }
      }
    }

    try {
      await updateAppointment(appt.id, appt.version, {
        crew_id: targetCrewId,
        scheduled_date: targetDate,
        time_block: targetTimeBlock,
        start_time: times.start,
        end_time: times.end,
        manual_override: manualOverride,
        override_source: overrideSource,
      });

      createAppointmentEvent({
        appointment_id: appt.id,
        action: "drag_moved",
        actor_id: null,
        actor_name_snapshot: null,
        before_state: { crew_id: appt.crew_id, scheduled_date: appt.scheduled_date, time_block: appt.time_block },
        after_state: { crew_id: targetCrewId, scheduled_date: targetDate, time_block: targetTimeBlock },
        reason: null,
      });

      showToast(`Moved to ${targetCrew.name} on ${targetDate}`, "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg === "VERSION_CONFLICT") {
        showToast("Someone else just updated this appointment — please try again", "warning");
      } else if (msg === "DOUBLE_BOOK") {
        showToast("That slot is already booked", "error");
      } else {
        showToast(`Failed to move: ${msg}`, "error");
      }
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
      await updateAppointment(appt.id, appt.version, {
        time_block_end: newEnd,
        end_time: endTimes.end,
      });

      createAppointmentEvent({
        appointment_id: appt.id,
        action: "drag_resized",
        actor_id: null,
        actor_name_snapshot: null,
        before_state: { time_block: appt.time_block, time_block_end: appt.time_block_end },
        after_state: { time_block: appt.time_block, time_block_end: newEnd },
        reason: null,
      });

      showToast(newEnd ? `Extended to ${newEnd}` : "Shrunk to single block", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      showToast(`Failed to resize: ${msg}`, "error");
    }
  }

  return (
    <div className="flex-1 overflow-auto">
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
          <div key={section.key}>
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center gap-1.5 px-2 py-1 bg-surface sticky top-0 z-10 hover:bg-border/50 transition-colors"
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

            {!isCollapsed && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[800px]">
                  <thead>
                    <tr>
                      <th className="w-28 px-1 py-0.5 text-[9px] text-muted font-medium text-left border-b border-border sticky left-0 bg-background z-10">
                        Crew
                      </th>
                      {days.map((day) => {
                        const today = isToday(day);
                        return (
                          <th
                            key={day.toISOString()}
                            className={`px-0.5 py-0.5 text-[9px] font-medium text-center border-b border-border min-w-[100px] cursor-pointer hover:bg-primary-light ${today ? "bg-primary-light" : ""}`}
                            onClick={() => onDayClick(day)}
                          >
                            <span className={today ? "text-primary font-bold" : ""}>
                              {format(day, "EEE")}
                            </span>
                            {" "}
                            <span className="text-muted">{format(day, "M/d")}</span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {section.crews.map((crew) => {
                      const showTimeLanes = isMeasure || (isDualRole(crew) && crewHasType(crew, "measure_tech"));

                      return (
                        <tr key={crew.id}>
                          <td className="px-1 py-0.5 text-[10px] font-medium border-b border-border sticky left-0 bg-background z-10">
                            <div className="flex items-center gap-1">
                              <div
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: crew.color }}
                              />
                              <span className="truncate leading-tight">{crew.name}</span>
                            </div>
                          </td>
                          {days.map((day) => {
                            const off = isCrewOffOnDay(crew, day);
                            const cellAppts = getAppointmentsForCrewAndDay(appointments, crew.id, day);
                            const dateStr = format(day, "yyyy-MM-dd");
                            const dayItems = rforceByDay.get(dateStr) || [];
                            const cellDisplayItems = dayItems.filter((r) => r.crewId === crew.id);
                            const hasConflict = off && cellAppts.length > 0;
                            const crewObj = crews.find((c) => c.id === crew.id);
                            const dayAvail = crewAvailability.get(crew.id)?.get(dateStr);

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
                                    setScheduleTarget({ date: day, crewId: crew.id, prefill: order })
                                  }
                                  onApproveRForce={approveRForce}
                                  onDismissRForce={dismissRForce}
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
                                showRForce={showRForce}
                                onCardClick={setSelectedAppt}
                                onRForceClick={(order, item) => setSelectedRForce({ order, crew: crewObj, displayItem: item })}
                                onSchedule={() =>
                                  setScheduleTarget({ date: day, crewId: crew.id })
                                }
                                getMultiDayLabel={getMultiDayLabel}
                                onDrop={(order) =>
                                  setScheduleTarget({ date: day, crewId: crew.id, prefill: order })
                                }
                                onAppointmentDrop={(apptId, srcCrewId, srcDate, srcBlock) =>
                                  handleAppointmentDrop(apptId, srcCrewId, srcDate, srcBlock, crew.id, format(day, "yyyy-MM-dd"), null)
                                }
                                onApproveRForce={approveRForce}
                                onDismissRForce={dismissRForce}
                              />
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

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
          onClose={() => setSelectedRForce(null)}
          onApprove={
            selectedRForce.displayItem?.displayMode === "approval"
              ? async () => {
                  const item = selectedRForce.displayItem!;
                  const dateStr = selectedRForce.order.scheduled_start?.slice(0, 10) || format(new Date(), "yyyy-MM-dd");
                  await approveRForce(selectedRForce.order, item.crewId, item.timeBlock, dateStr);
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
          date={new Date(editingAppt.scheduled_date)}
          editingAppointment={editingAppt}
          onClose={() => setEditingAppt(null)}
        />
      )}

      {reschedulingAppt && (
        <ScheduleModal
          date={new Date(reschedulingAppt.scheduled_date)}
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
          onClose={() => setScheduleTarget(null)}
        />
      )}
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
}: {
  crew: Crew;
  day: Date;
  off: boolean;
  hasConflict: boolean;
  cellAppts: Appointment[];
  cellDisplayItems: RForceDisplayItem[];
  rforceOrders: any[];
  searchQuery: string;
  crewObj: Crew | undefined;
  blockedBlocks: Set<TimeBlock>;
  sectionType: string;
  timeOffColor?: string;
  availability?: CrewDayAvailability;
  showRForce?: boolean;
  onCardClick: (a: Appointment) => void;
  onRForceClick: (order: RForceOrder, displayItem?: RForceDisplayItem) => void;
  onSchedule: (block: TimeBlock) => void;
  getMultiDayLabel: (a: Appointment, d: Date) => string | null;
  onAppointmentDrop?: (apptId: string, srcCrewId: string, srcDate: string, srcBlock: TimeBlock | null, targetBlock: TimeBlock) => void;
  onResizeDrop?: (apptId: string, targetBlock: TimeBlock) => void;
  onQueueDrop?: (order: RForceOrder) => void;
  onApproveRForce?: (order: RForceOrder, crewId: string, tb: TimeBlock, date: string) => Promise<Appointment | null>;
  onDismissRForce?: (workOrderNumber: string, rforceDate: string, startTime?: string) => Promise<void>;
}) {
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

  const approvalItems = cellDisplayItems.filter((d) => d.displayMode === "approval");
  const discrepancyItems = cellDisplayItems.filter((d) => d.displayMode === "discrepancy");
  const visibleRForce = cellDisplayItems.filter((d) =>
    d.displayMode === "synced" || d.displayMode === "regular"
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
    const draggedAppt = getDraggedAppointment();
    if (draggedAppt) {
      onAppointmentDrop?.(draggedAppt.appointment.id, draggedAppt.sourceCrewId, draggedAppt.sourceDate, draggedAppt.sourceTimeBlock, MEASURE_TIME_BLOCKS[0]);
      setDraggedAppointment(null);
      return;
    }
    const order = getDraggedOrder();
    if (order) {
      onQueueDrop?.(order);
      setDraggedOrder(null);
    }
  }

  return (
    <td
      className={`p-0 border-b border-border border-l border-l-border/30 align-top ${
        hasConflict
          ? "bg-time-off-conflict/10"
          : off
            ? (timeOffColor ? "" : "bg-time-off-light/60")
            : ""
      } ${cellDragOver ? "ring-2 ring-primary ring-inset" : ""}`}
      style={off && !hasConflict && timeOffColor ? offStyle : hasConflict && timeOffColor ? { backgroundColor: `${timeOffColor}20` } : undefined}
      onDragOver={handleCellDragOver}
      onDragLeave={handleCellDragLeave}
      onDrop={handleCellDrop}
    >
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
              const resizing = getResizingAppointment();
              if (resizing) {
                onResizeDrop?.(resizing.appointmentId, block);
                setResizingAppointment(null);
                return;
              }
              const draggedAppt = getDraggedAppointment();
              if (draggedAppt) {
                onAppointmentDrop?.(draggedAppt.appointment.id, draggedAppt.sourceCrewId, draggedAppt.sourceDate, draggedAppt.sourceTimeBlock, block);
                setDraggedAppointment(null);
                return;
              }
              const order = getDraggedOrder();
              if (order) {
                onQueueDrop?.(order);
                setDraggedOrder(null);
              }
            }

            return (
              <div
                key={block}
                className={`flex items-stretch min-h-[18px] border-b border-border/20 last:border-b-0 ${isDropTarget ? "ring-2 ring-primary ring-inset bg-primary/5" : ""}`}
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
                    <div>
                      {/* rForce layer on top */}
                      {blockRForce.length > 0 && (
                        <div className={blockAppts.length > 0 ? "pb-0.5 mb-0.5" : ""} style={blockAppts.length > 0 ? { borderBottom: "1px dashed var(--color-border)" } : undefined}>
                          {blockRForce.filter((rf) => rf.displayMode !== "approval").map((rf) => {
                            const dimmed = !!searchQuery && !rforceItemMatchesSearch(rf, crewObj, searchQuery);
                            return (
                              <WeekCard key={rf.rforceOrder.work_order_number} dimmed={dimmed} onClick={() => onRForceClick(rf.rforceOrder, rf)}>
                                <CompactRForceContent order={rf.rforceOrder} crew={crewObj} isSynced={rf.displayMode === "synced"} />
                              </WeekCard>
                            );
                          })}
                          {blockRForce.filter((rf) => rf.displayMode === "approval").map((rf) => (
                            <ApprovalCard
                              key={`approve-${rf.rforceOrder.work_order_number}`}
                              rforceOrder={rf.rforceOrder}
                              crew={crewObj}
                              compact
                              onApprove={async () => {
                                await onApproveRForce?.(rf.rforceOrder, crew.id, rf.timeBlock, dateStr);
                              }}
                              onDismiss={() =>
                                onDismissRForce?.(rf.rforceOrder.work_order_number, dateStr, rf.rforceOrder.scheduled_start?.slice(11, 16)) ?? Promise.resolve()
                              }
                              onClick={() => onRForceClick(rf.rforceOrder, rf)}
                            />
                          ))}
                        </div>
                      )}
                      {/* App layer below */}
                      {blockAppts.map((a) => {
                        const isSpanStart = a.time_block === block;
                        if (!isSpanStart && a.time_block_end) return null;
                        const dimmed = !!searchQuery && !appointmentMatchesSearch(a, crewObj, searchQuery);
                        const multiDay = getMultiDayLabel(a, day);
                        const spanLen = a.time_block_end ? MEASURE_TIME_BLOCKS.indexOf(a.time_block_end) - MEASURE_TIME_BLOCKS.indexOf(a.time_block!) + 1 : 1;
                        const discItem = discrepancyByApptId.get(a.id);
                        return (
                          <div key={a.id} className="relative">
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
                                hasDiscrepancy={!!discItem || checkDiscrepancy(a, rforceOrders)}
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
                      <button
                        onClick={() => onSchedule(block)}
                        className="w-full h-3 flex items-center justify-center hover:bg-primary-light/30 transition-colors"
                      >
                        <Plus size={7} className="text-muted/20 hover:text-primary" />
                      </button>
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
    </td>
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
  showRForce,
  onCardClick,
  onSchedule,
  onRForceClick,
  getMultiDayLabel,
  onDrop,
  onAppointmentDrop,
  onApproveRForce,
  onDismissRForce,
}: {
  crew: Crew;
  day: Date;
  off: boolean;
  hasConflict: boolean;
  cellAppts: Appointment[];
  cellDisplayItems: RForceDisplayItem[];
  rforceOrders: any[];
  searchQuery: string;
  crewObj: Crew | undefined;
  timeOffColor?: string;
  availability?: CrewDayAvailability;
  showRForce?: boolean;
  onCardClick: (a: Appointment) => void;
  onSchedule: () => void;
  onRForceClick: (order: RForceOrder, displayItem?: RForceDisplayItem) => void;
  getMultiDayLabel: (a: Appointment, d: Date) => string | null;
  onDrop?: (order: RForceOrder) => void;
  onAppointmentDrop?: (apptId: string, srcCrewId: string, srcDate: string, srcBlock: TimeBlock | null) => void;
  onApproveRForce?: (order: RForceOrder, crewId: string, tb: TimeBlock, date: string) => Promise<Appointment | null>;
  onDismissRForce?: (workOrderNumber: string, rforceDate: string, startTime?: string) => Promise<void>;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dateStr = format(day, "yyyy-MM-dd");

  const approvalItems = cellDisplayItems.filter((d) => d.displayMode === "approval");
  const discrepancyItems = cellDisplayItems.filter((d) => d.displayMode === "discrepancy");
  const visibleRForce = showRForce
    ? cellDisplayItems.filter((d) => d.displayMode === "synced" || d.displayMode === "regular")
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
    const draggedAppt = getDraggedAppointment();
    if (draggedAppt) {
      onAppointmentDrop?.(draggedAppt.appointment.id, draggedAppt.sourceCrewId, draggedAppt.sourceDate, draggedAppt.sourceTimeBlock);
      setDraggedAppointment(null);
      return;
    }
    const order = getDraggedOrder();
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

  if (off && !hasContent) {
    return (
      <td
        className={`p-0.5 border-b border-border border-l border-l-border/30 align-top ${timeOffColor ? "" : "bg-time-off-light/40"} ${dragOver ? "ring-2 ring-primary ring-inset" : ""}`}
        style={timeOffColor ? offStyle : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div
          className={`w-full h-6 rounded-sm flex items-center justify-center border border-dashed ${timeOffColor ? "" : "bg-time-off-light/30 border-time-off/40"}`}
          style={timeOffColor ? { ...offStyle, ...offBorderStyle } : undefined}
        >
          <Palmtree size={10} style={timeOffColor ? { color: `${timeOffColor}90` } : undefined} className={timeOffColor ? "" : "text-time-off/50"} />
        </div>
      </td>
    );
  }

  if (crewUnavailable && !hasContent) {
    return (
      <td
        className={`p-0.5 border-b border-border border-l border-l-border/30 align-top bg-muted/5 ${dragOver ? "ring-2 ring-primary ring-inset" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="w-full h-6 rounded-sm flex items-center justify-center border border-dashed bg-muted/5 border-muted/20">
          <Ban size={9} className="text-muted/30" />
        </div>
      </td>
    );
  }

  return (
    <td
      className={`p-0.5 border-b border-border border-l border-l-border/30 align-top ${
        hasConflict
          ? (timeOffColor ? "" : "bg-time-off-conflict/10")
          : off
            ? (timeOffColor ? "" : "bg-time-off-light/40")
            : ""
      } ${dragOver ? "ring-2 ring-primary ring-inset" : ""}`}
      style={
        hasConflict && timeOffColor
          ? { backgroundColor: `${timeOffColor}20` }
          : off && timeOffColor
            ? offStyle
            : undefined
      }
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {hasConflict && (
        <div className="text-[8px] font-semibold px-0.5 flex items-center gap-0.5">
          <Palmtree size={8} style={timeOffColor ? { color: timeOffColor } : undefined} className={timeOffColor ? "" : "text-time-off"} />
          <span style={timeOffColor ? { color: timeOffColor } : undefined} className={timeOffColor ? "" : "text-time-off-conflict"}>OFF</span>
        </div>
      )}
      {hasContent ? (
        <div>
          {/* rForce layer — shown above app tiles when overlay is on */}
          {(visibleRForce.length > 0 || approvalItems.length > 0) && (
            <div className="space-y-0.5 pb-0.5" style={visibleRForce.length > 0 || approvalItems.length > 0 ? { borderBottom: "1px dashed var(--color-border)" } : undefined}>
              {visibleRForce.map((rf) => {
                const dimmed = !!searchQuery && !rforceItemMatchesSearch(rf, crewObj, searchQuery);
                return (
                  <WeekCard key={rf.rforceOrder.work_order_number} dimmed={dimmed} onClick={() => onRForceClick(rf.rforceOrder, rf)}>
                    <CompactRForceContent order={rf.rforceOrder} crew={crewObj} isSynced={rf.displayMode === "synced"} />
                  </WeekCard>
                );
              })}
              {approvalItems.map((rf) => (
                <ApprovalCard
                  key={`approve-${rf.rforceOrder.work_order_number}`}
                  rforceOrder={rf.rforceOrder}
                  crew={crewObj}
                  compact
                  onApprove={async () => {
                    await onApproveRForce?.(rf.rforceOrder, crew.id, rf.timeBlock, dateStr);
                  }}
                  onDismiss={async () => {
                    await onDismissRForce?.(rf.rforceOrder.work_order_number, dateStr, rf.rforceOrder.scheduled_start?.slice(11, 16));
                  }}
                  onClick={() => onRForceClick(rf.rforceOrder, rf)}
                />
              ))}
            </div>
          )}
          {/* App layer — source of truth appointments */}
          <div className="space-y-0.5 pt-0.5">
            {sortedAppts.map((a) => {
              const dimmed = !!searchQuery && !appointmentMatchesSearch(a, crewObj, searchQuery);
              const multiDay = getMultiDayLabel(a, day);
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
                      hasDiscrepancy={!!discItem || checkDiscrepancy(a, rforceOrders)}
                      multiDayLabel={multiDay}
                      orderAlerts={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.order_alerts || rforceByWo.get(a.work_order_number)?.scheduler_notes || null) : null}
                      accountName={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.account_name || null) : null}
                    />
                  </WeekCard>
                  {discItem && <DiscrepancyBadge differences={discItem.differences} onClick={() => onRForceClick(discItem.rforceOrder, discItem)} />}
                </div>
              );
            })}
            <button
              onClick={onSchedule}
              className="w-full h-4 flex items-center justify-center hover:bg-primary-light/30 transition-colors"
            >
              <Plus size={7} className="text-muted/15 hover:text-primary" />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onSchedule}
          className="w-full h-6 rounded-sm border border-dashed border-border/20 hover:border-primary hover:bg-primary-light/30 transition-colors flex items-center justify-center group"
        >
          <Plus size={8} className="text-muted/15 group-hover:text-primary" />
        </button>
      )}
    </td>
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
  const bgColor = crew?.color || "#1a73e8";
  const city = parseCity(appointment.address);
  const isLinked = !!appointment.work_order_number;

  return (
    <div className="rounded-sm px-1 py-0.5 text-white" style={{ backgroundColor: bgColor }}>
      {orderAlerts && (
        <div className="truncate text-yellow-200 text-[8px] leading-tight">{orderAlerts}</div>
      )}
      <div className="font-semibold truncate flex items-center gap-0.5">
        {appointment.customer_name}
        {appointment.manual_override ? (
          <span className="text-blue-200 text-[7px] font-bold" title="Manual override">M</span>
        ) : hasDiscrepancy ? (
          <span className="text-yellow-200 text-[7px]">!</span>
        ) : null}
        {showRForce && (
          isLinked ? (
            hasDiscrepancy ? (
              <span className="text-amber-300 text-[7px]" title="rForce mismatch">&#9888;</span>
            ) : (
              <span className="text-green-300 text-[7px]" title="In sync with rForce">&#10003;</span>
            )
          ) : (
            <span title="Not linked to rForce"><Unlink size={7} className="shrink-0 opacity-60" /></span>
          )
        )}
      </div>
      {accountName && <div className="truncate opacity-70 text-[7px]">{accountName}</div>}
      {city && <div className="truncate opacity-80 text-[8px]">{city}</div>}
      {multiDayLabel && (
        <div className="opacity-70 text-[8px]">{multiDayLabel}</div>
      )}
    </div>
  );
}

function CompactRForceContent({
  order,
  crew,
  isSynced,
}: {
  order: any;
  crew?: Crew;
  isSynced?: boolean;
}) {
  const borderColor = crew?.color || "#888";
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
