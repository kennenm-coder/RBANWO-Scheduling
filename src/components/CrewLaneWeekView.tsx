"use client";

import { useState, useMemo } from "react";
import { useData } from "./DataProvider";
import AppointmentCard from "./AppointmentCard";
import RForceCard from "./RForceCard";
import AppointmentSheet from "./AppointmentSheet";
import RForceDetailSheet from "./RForceDetailSheet";
import ScheduleModal from "./ScheduleModal";
import {
  Appointment,
  Crew,
  RForceOrder,
  TimeBlock,
  AppointmentType,
} from "@/lib/types";
import {
  getWeekDays,
  getAppointmentsForCrewAndDay,
  getRForceItemsForDay,
  checkDiscrepancy,
  MEASURE_TIME_BLOCKS,
  timeBlockLabel,
  RForceCalendarItem,
} from "@/lib/calendar-utils";
import { getTimeOffForDate } from "@/lib/store";
import { getDepartmentSections } from "@/lib/crew-utils";
import { parseCity } from "@/lib/crew-utils";
import { appointmentMatchesSearch, rforceItemMatchesSearch } from "@/lib/search-utils";
import { format, isToday, parseISO, addDays } from "date-fns";
import { Plus, Palmtree, ChevronDown, ChevronRight } from "lucide-react";
import { getDraggedOrder } from "@/lib/drag-context";

interface Props {
  currentDate: Date;
  onDayClick: (date: Date) => void;
  filterType?: AppointmentType | "all";
  searchQuery?: string;
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
}: Props) {
  const { crews, appointments, rforceOrders, timeOffRequests } = useData();

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
  const [selectedRForce, setSelectedRForce] = useState<{ order: RForceOrder; crew?: Crew } | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

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

  const rforceByDay = useMemo(() => {
    const map = new Map<string, RForceCalendarItem[]>();
    for (const day of days) {
      map.set(format(day, "yyyy-MM-dd"), getRForceItemsForDay(rforceOrders, appointments, crews, day));
    }
    return map;
  }, [days, rforceOrders, appointments, crews]);

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
            sectionJobCount += dayRForce.filter((r) => r.crewId === crew.id).length;
            if (isCrewOffOnDay(crew, day) && cellAppts.length > 0) {
              sectionConflictCount++;
            }
          }
        }

        return (
          <div key={section.key} className="mb-1">
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center gap-2 px-3 py-1.5 bg-surface sticky top-0 z-10 hover:bg-border/50 transition-colors"
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                {section.title}
              </span>
              <span className="text-[10px] text-muted ml-1">
                {sectionJobCount} jobs
              </span>
              {sectionConflictCount > 0 && (
                <span className="text-[10px] bg-danger text-white px-1.5 rounded-full">
                  {sectionConflictCount} conflicts
                </span>
              )}
            </button>

            {!isCollapsed && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[900px]">
                  <thead>
                    <tr>
                      <th className="w-32 p-1.5 text-[10px] text-muted font-medium text-left border-b border-border sticky left-0 bg-background z-10">
                        Crew
                      </th>
                      {days.map((day) => {
                        const today = isToday(day);
                        return (
                          <th
                            key={day.toISOString()}
                            className={`p-1.5 text-[10px] font-medium text-center border-b border-border min-w-[120px] cursor-pointer hover:bg-primary-light ${today ? "bg-primary-light" : ""}`}
                            onClick={() => onDayClick(day)}
                          >
                            <div className={today ? "text-primary font-bold" : ""}>
                              {format(day, "EEE")}
                            </div>
                            <div className="text-muted">{format(day, "M/d")}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {section.crews.map((crew) => (
                      <tr key={crew.id}>
                        <td className="p-1.5 text-xs font-medium border-b border-border sticky left-0 bg-background z-10">
                          <div className="flex items-center gap-1">
                            <div
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: crew.color }}
                            />
                            <span className="truncate">{crew.name}</span>
                          </div>
                        </td>
                        {days.map((day) => {
                          const off = isCrewOffOnDay(crew, day);
                          const cellAppts = getAppointmentsForCrewAndDay(appointments, crew.id, day);
                          const dateStr = format(day, "yyyy-MM-dd");
                          const dayRForce = rforceByDay.get(dateStr) || [];
                          const cellRForce = dayRForce.filter((r) => r.crewId === crew.id);
                          const hasConflict = off && cellAppts.length > 0;
                          const crewObj = crews.find((c) => c.id === crew.id);

                          if (isMeasure) {
                            return (
                              <MeasureTimeLaneCell
                                key={day.toISOString()}
                                crew={crew}
                                day={day}
                                off={off}
                                hasConflict={hasConflict}
                                cellAppts={cellAppts}
                                cellRForce={cellRForce}
                                rforceOrders={rforceOrders}
                                searchQuery={searchQuery}
                                crewObj={crewObj}
                                onCardClick={setSelectedAppt}
                                onRForceClick={(order) => setSelectedRForce({ order, crew: crewObj })}
                                onSchedule={(block) =>
                                  setScheduleTarget({ date: day, crewId: crew.id, timeBlock: block })
                                }
                                getMultiDayLabel={getMultiDayLabel}
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
                              cellRForce={cellRForce}
                              rforceOrders={rforceOrders}
                              searchQuery={searchQuery}
                              crewObj={crewObj}
                              onCardClick={setSelectedAppt}
                              onRForceClick={(order) => setSelectedRForce({ order, crew: crewObj })}
                              onSchedule={() =>
                                setScheduleTarget({ date: day, crewId: crew.id })
                              }
                              getMultiDayLabel={getMultiDayLabel}
                              onDrop={(order) =>
                                setScheduleTarget({ date: day, crewId: crew.id, prefill: order })
                              }
                            />
                          );
                        })}
                      </tr>
                    ))}
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
  cellRForce,
  rforceOrders,
  searchQuery,
  crewObj,
  onCardClick,
  onRForceClick,
  onSchedule,
  getMultiDayLabel,
}: {
  crew: Crew;
  day: Date;
  off: boolean;
  hasConflict: boolean;
  cellAppts: Appointment[];
  cellRForce: RForceCalendarItem[];
  rforceOrders: any[];
  searchQuery: string;
  crewObj: Crew | undefined;
  onCardClick: (a: Appointment) => void;
  onRForceClick: (order: RForceOrder) => void;
  onSchedule: (block: TimeBlock) => void;
  getMultiDayLabel: (a: Appointment, d: Date) => string | null;
}) {
  const allApptsSorted = [...cellAppts].sort((a, b) => {
    const blockOrder = MEASURE_TIME_BLOCKS as string[];
    const aIdx = a.time_block ? blockOrder.indexOf(a.time_block) : 99;
    const bIdx = b.time_block ? blockOrder.indexOf(b.time_block) : 99;
    return aIdx - bIdx;
  });

  const allRForceSorted = [...cellRForce].sort((a, b) => {
    const blockOrder = MEASURE_TIME_BLOCKS as string[];
    return blockOrder.indexOf(a.timeBlock) - blockOrder.indexOf(b.timeBlock);
  });

  return (
    <td
      className={`p-0.5 border-b border-border border-l border-l-border/50 align-top ${
        hasConflict
          ? "bg-red-50/60 dark:bg-red-900/20"
          : off
            ? "bg-amber-100/40 dark:bg-amber-900/25"
            : ""
      }`}
    >
      {hasConflict && (
        <div className="text-[9px] text-danger font-semibold px-1 flex items-center gap-0.5">
          <Palmtree size={9} className="text-amber-500" />
          OFF — jobs scheduled
        </div>
      )}
      {off && cellAppts.length === 0 && cellRForce.length === 0 && (
        <div className="w-full h-8 rounded bg-amber-200/60 dark:bg-amber-800/25 border border-dashed border-amber-400/60 dark:border-amber-600/40 flex items-center justify-center">
          <Palmtree size={12} className="text-amber-500/70 dark:text-amber-400/60" />
        </div>
      )}
      {(!off || cellAppts.length > 0 || cellRForce.length > 0) && (
        <div className="space-y-0.5">
          {MEASURE_TIME_BLOCKS.map((block) => {
            const blockAppts = allApptsSorted.filter((a) => a.time_block === block);
            const blockRForce = allRForceSorted.filter((r) => r.timeBlock === block);
            const hasItems = blockAppts.length > 0 || blockRForce.length > 0;

            return (
              <div key={block} className="flex items-stretch gap-0.5 min-h-[22px]">
                <div className="w-[38px] shrink-0 text-[8px] text-muted flex items-center justify-center bg-surface/50 rounded-sm leading-none">
                  {SHORT_BLOCK_LABELS[block] || block}
                </div>
                <div className="flex-1 min-w-0">
                  {hasItems ? (
                    <div className="space-y-0.5">
                      {blockAppts.map((a) => {
                        const dimmed = !!searchQuery && !appointmentMatchesSearch(a, crewObj, searchQuery);
                        const multiDay = getMultiDayLabel(a, day);
                        return (
                          <WeekCard
                            key={a.id}
                            dimmed={dimmed}
                            onClick={() => onCardClick(a)}
                          >
                            <CompactAppointmentContent
                              appointment={a}
                              crew={crewObj}
                              hasDiscrepancy={checkDiscrepancy(a, rforceOrders)}
                              multiDayLabel={multiDay}
                            />
                          </WeekCard>
                        );
                      })}
                      {blockRForce.map((rf) => {
                        const dimmed = !!searchQuery && !rforceItemMatchesSearch(rf, crewObj, searchQuery);
                        return (
                          <WeekCard
                            key={rf.rforceOrder.work_order_number}
                            dimmed={dimmed}
                            onClick={() => onRForceClick(rf.rforceOrder)}
                          >
                            <CompactRForceContent order={rf.rforceOrder} crew={crewObj} />
                          </WeekCard>
                        );
                      })}
                      <button
                        onClick={() => onSchedule(block)}
                        className="w-full h-4 rounded border border-dashed border-border/20 hover:border-primary hover:bg-primary-light/30 transition-colors flex items-center justify-center"
                      >
                        <Plus size={8} className="text-muted/30 hover:text-primary" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onSchedule(block)}
                      className="w-full h-full min-h-[22px] rounded border border-dashed border-border/20 hover:border-primary hover:bg-primary-light/30 transition-colors flex items-center justify-center"
                    >
                      <Plus size={8} className="text-muted/20 group-hover:text-primary" />
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
  cellRForce,
  rforceOrders,
  searchQuery,
  crewObj,
  onCardClick,
  onSchedule,
  onRForceClick,
  getMultiDayLabel,
  onDrop,
}: {
  crew: Crew;
  day: Date;
  off: boolean;
  hasConflict: boolean;
  cellAppts: Appointment[];
  cellRForce: RForceCalendarItem[];
  rforceOrders: any[];
  searchQuery: string;
  crewObj: Crew | undefined;
  onCardClick: (a: Appointment) => void;
  onSchedule: () => void;
  onRForceClick: (order: RForceOrder) => void;
  getMultiDayLabel: (a: Appointment, d: Date) => string | null;
  onDrop?: (order: RForceOrder) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const hasContent = cellAppts.length > 0 || cellRForce.length > 0;

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
    const order = getDraggedOrder();
    if (order && onDrop) onDrop(order);
  }

  const sortedAppts = [...cellAppts].sort((a, b) =>
    (a.start_time || "08:00").localeCompare(b.start_time || "08:00")
  );

  if (off && !hasContent) {
    return (
      <td
        className={`p-1 border-b border-border border-l border-l-border/50 align-top bg-amber-100/60 dark:bg-amber-900/30 ${dragOver ? "ring-2 ring-primary ring-inset" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="w-full h-8 rounded bg-amber-200/60 dark:bg-amber-800/25 border border-dashed border-amber-400/60 dark:border-amber-600/40 flex items-center justify-center">
          <Palmtree size={12} className="text-amber-500/70 dark:text-amber-400/60" />
        </div>
      </td>
    );
  }

  return (
    <td
      className={`p-1 border-b border-border border-l border-l-border/50 align-top ${
        hasConflict
          ? "bg-red-50/60 dark:bg-red-900/20"
          : off
            ? "bg-amber-100/40 dark:bg-amber-900/25"
            : ""
      } ${dragOver ? "ring-2 ring-primary ring-inset" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {hasConflict && (
        <div className="text-[9px] text-danger font-semibold px-0.5 flex items-center gap-0.5 mb-0.5">
          <Palmtree size={9} className="text-amber-500" />
          OFF
        </div>
      )}
      {hasContent ? (
        <div className="space-y-1">
          {sortedAppts.map((a) => {
            const dimmed = !!searchQuery && !appointmentMatchesSearch(a, crewObj, searchQuery);
            const multiDay = getMultiDayLabel(a, day);
            return (
              <WeekCard
                key={a.id}
                dimmed={dimmed}
                onClick={() => onCardClick(a)}
              >
                <CompactAppointmentContent
                  appointment={a}
                  crew={crewObj}
                  hasDiscrepancy={checkDiscrepancy(a, rforceOrders)}
                  multiDayLabel={multiDay}
                />
              </WeekCard>
            );
          })}
          {cellRForce.map((rf) => {
            const dimmed = !!searchQuery && !rforceItemMatchesSearch(rf, crewObj, searchQuery);
            return (
              <WeekCard
                key={rf.rforceOrder.work_order_number}
                dimmed={dimmed}
                onClick={() => onRForceClick(rf.rforceOrder)}
              >
                <CompactRForceContent order={rf.rforceOrder} crew={crewObj} />
              </WeekCard>
            );
          })}
          <button
            onClick={onSchedule}
            className="w-full h-5 rounded border border-dashed border-border/20 hover:border-primary hover:bg-primary-light/30 transition-colors flex items-center justify-center"
          >
            <Plus size={8} className="text-muted/20 hover:text-primary" />
          </button>
        </div>
      ) : (
        <button
          onClick={onSchedule}
          className="w-full h-8 rounded border border-dashed border-border/30 hover:border-primary hover:bg-primary-light/30 transition-colors flex items-center justify-center group"
        >
          <Plus size={10} className="text-muted/20 group-hover:text-primary" />
        </button>
      )}
    </td>
  );
}

function WeekCard({
  children,
  dimmed,
  onClick,
}: {
  children: React.ReactNode;
  dimmed?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded p-1 cursor-pointer hover:shadow-md transition-all text-[10px] leading-tight overflow-hidden ${
        dimmed ? "opacity-30" : ""
      }`}
    >
      {children}
    </div>
  );
}

function CompactAppointmentContent({
  appointment,
  crew,
  hasDiscrepancy,
  multiDayLabel,
}: {
  appointment: Appointment;
  crew?: Crew;
  hasDiscrepancy: boolean;
  multiDayLabel: string | null;
}) {
  const bgColor = crew?.color || "#1a73e8";
  const city = parseCity(appointment.address);

  return (
    <div className="rounded p-1 text-white" style={{ backgroundColor: bgColor }}>
      <div className="font-semibold truncate flex items-center gap-0.5">
        {appointment.customer_name}
        {hasDiscrepancy && (
          <span className="text-yellow-200 text-[8px]">!</span>
        )}
      </div>
      <div className="truncate opacity-85">{city}</div>
      {multiDayLabel && (
        <div className="opacity-75 text-[9px]">{multiDayLabel}</div>
      )}
    </div>
  );
}

function CompactRForceContent({
  order,
  crew,
}: {
  order: any;
  crew?: Crew;
}) {
  const bgColor = crew?.color || "#888";
  const city = parseCity(order.address || "");

  return (
    <div className="rounded p-1 text-white" style={{ backgroundColor: bgColor }}>
      <div className="font-semibold truncate flex items-center gap-0.5">
        {order.customer_name || "Unknown"}
        <span className="text-[7px] opacity-60 font-normal ml-auto bg-white/20 px-0.5 rounded">rF</span>
      </div>
      {city && <div className="truncate opacity-85">{city}</div>}
    </div>
  );
}
