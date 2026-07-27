"use client";

import { useState, useMemo } from "react";
import { useData } from "./DataProvider";
import AppointmentCard from "./AppointmentCard";
import RForceCard from "./RForceCard";
import AppointmentSheet from "./AppointmentSheet";
import ScheduleModal from "./ScheduleModal";
import { Appointment, Crew } from "@/lib/types";
import {
  getWeekDays,
  getAppointmentsForCrewAndDay,
  getRForceItemsForDay,
  checkDiscrepancy,
} from "@/lib/calendar-utils";
import { getTimeOffForDate } from "@/lib/store";
import { openSalesforce } from "@/lib/salesforce";
import { format, isToday } from "date-fns";
import { Plus, Palmtree } from "lucide-react";

interface Props {
  currentDate: Date;
  onDayClick: (date: Date) => void;
}

export default function CrewLaneWeekView({
  currentDate,
  onDayClick,
}: Props) {
  const { crews, appointments, rforceOrders, timeOffRequests } = useData();

  const days = getWeekDays(currentDate);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    date: Date;
    crewId: string;
  } | null>(null);

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
    const map = new Map<string, ReturnType<typeof getRForceItemsForDay>>();
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

  const activeCrews = crews.filter((c) => c.is_active && c.crew_type !== "misc" && c.crew_type !== "second" && c.crew_type !== "management");
  const installCrews = activeCrews.filter(
    (c) =>
      c.crew_type === "install_in_house" ||
      c.crew_type === "install_sub" ||
      c.crew_type === "jip" ||
      c.crew_type === "svc"
  );
  const measureCrews = activeCrews.filter((c) => c.crew_type === "measure_tech");
  const allCrews = [...measureCrews, ...installCrews];

  return (
    <div className="flex-1 overflow-auto">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[800px]">
          <thead>
            <tr>
              <th className="w-32 p-2 text-xs text-muted font-medium text-left border-b border-border sticky left-0 bg-background z-10">
                Crew
              </th>
              {days.map((day) => {
                const today = isToday(day);
                return (
                  <th
                    key={day.toISOString()}
                    className={`p-2 text-xs font-medium text-center border-b border-border min-w-[100px] cursor-pointer hover:bg-primary-light ${today ? "bg-primary-light" : ""}`}
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
            {allCrews.map((crew) => (
              <tr key={crew.id}>
                <td className="p-2 text-xs font-medium border-b border-border sticky left-0 bg-background z-10">
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
                  const cellAppts = getAppointmentsForCrewAndDay(
                    appointments,
                    crew.id,
                    day
                  );
                  const dateStr = format(day, "yyyy-MM-dd");
                  const dayRForce = rforceByDay.get(dateStr) || [];
                  const cellRForce = dayRForce.filter((r) => r.crewId === crew.id);
                  const hasContent = cellAppts.length > 0 || cellRForce.length > 0;

                  if (off && !hasContent) {
                    return (
                      <td
                        key={day.toISOString()}
                        className="p-1 border-b border-border border-l border-l-border/50 align-top bg-amber-50/50 dark:bg-amber-900/5"
                      >
                        <div className="w-full h-8 rounded bg-amber-100/50 dark:bg-amber-900/10 border border-dashed border-amber-300/40 dark:border-amber-700/30 flex items-center justify-center">
                          <Palmtree size={10} className="text-amber-400/40" />
                        </div>
                      </td>
                    );
                  }

                  return (
                    <td
                      key={day.toISOString()}
                      className={`p-1 border-b border-border border-l border-l-border/50 align-top ${off ? "bg-amber-50/30 dark:bg-amber-900/5" : ""}`}
                    >
                      {hasContent ? (
                        <div className="space-y-1">
                          {cellAppts.map((a) => (
                            <AppointmentCard
                              key={a.id}
                              appointment={a}
                              crew={crew}
                              compact
                              hasDiscrepancy={checkDiscrepancy(a, rforceOrders)}
                              onClick={() => setSelectedAppt(a)}
                            />
                          ))}
                          {cellRForce.map((rf) => (
                            <RForceCard
                              key={rf.rforceOrder.work_order_number}
                              order={rf.rforceOrder}
                              crew={crew}
                              compact
                              onClick={() =>
                                openSalesforce(
                                  rf.rforceOrder.work_order_number,
                                  rf.rforceOrder.order_number
                                )
                              }
                            />
                          ))}
                        </div>
                      ) : (
                        <button
                          onClick={() =>
                            setScheduleTarget({
                              date: day,
                              crewId: crew.id,
                            })
                          }
                          className="w-full h-8 rounded border border-dashed border-border/30 hover:border-primary hover:bg-primary-light/30 transition-colors flex items-center justify-center group"
                        >
                          <Plus
                            size={10}
                            className="text-muted/20 group-hover:text-primary"
                          />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedAppt && (
        <AppointmentSheet
          appointment={selectedAppt}
          onClose={() => setSelectedAppt(null)}
          onEdit={() => {
            setEditingAppt(selectedAppt);
            setSelectedAppt(null);
          }}
        />
      )}

      {editingAppt && (
        <ScheduleModal
          date={new Date(editingAppt.scheduled_date)}
          editingAppointment={editingAppt}
          onClose={() => setEditingAppt(null)}
        />
      )}

      {scheduleTarget && (
        <ScheduleModal
          date={scheduleTarget.date}
          crewId={scheduleTarget.crewId}
          onClose={() => setScheduleTarget(null)}
        />
      )}
    </div>
  );
}
