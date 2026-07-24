"use client";

import { useState } from "react";
import { useData } from "./DataProvider";
import AppointmentCard from "./AppointmentCard";
import AppointmentSheet from "./AppointmentSheet";
import ScheduleModal from "./ScheduleModal";
import { Appointment } from "@/lib/types";
import {
  getWeekDays,
  getAppointmentsForCrewAndDay,
} from "@/lib/calendar-utils";
import { format, isToday } from "date-fns";
import { Plus } from "lucide-react";

interface Props {
  currentDate: Date;
  onDayClick: (date: Date) => void;
}

export default function CrewLaneWeekView({
  currentDate,
  onDayClick,
}: Props) {
  const { crews, appointments } = useData();
  const days = getWeekDays(currentDate);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    date: Date;
    crewId: string;
  } | null>(null);

  const installCrews = crews.filter(
    (c) =>
      c.crew_type === "install_in_house" ||
      c.crew_type === "install_sub" ||
      c.crew_type === "jip" ||
      c.crew_type === "svc"
  );
  const measureCrews = crews.filter((c) => c.crew_type === "measure_tech");

  return (
    <div className="flex-1 overflow-auto">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[800px]">
          <thead>
            <tr>
              <th className="w-20 p-2 text-xs text-muted font-medium text-left border-b border-border sticky left-0 bg-background z-10">
                Day
              </th>
              {[...measureCrews, ...installCrews].map((crew) => (
                <th
                  key={crew.id}
                  className="p-1 text-[10px] font-medium text-center border-b border-border min-w-[100px]"
                >
                  <div className="flex items-center justify-center gap-1">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: crew.color }}
                    />
                    <span className="truncate">{crew.name}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const today = isToday(day);
              return (
                <tr key={day.toISOString()}>
                  <td
                    className={`p-2 text-xs font-medium border-b border-border sticky left-0 z-10 cursor-pointer hover:bg-primary-light ${
                      today ? "bg-primary-light" : "bg-background"
                    }`}
                    onClick={() => onDayClick(day)}
                  >
                    <div
                      className={`${today ? "text-primary font-bold" : ""}`}
                    >
                      {format(day, "EEE")}
                    </div>
                    <div className="text-muted">{format(day, "M/d")}</div>
                  </td>
                  {[...measureCrews, ...installCrews].map((crew) => {
                    const cellAppts = getAppointmentsForCrewAndDay(
                      appointments,
                      crew.id,
                      day
                    );
                    return (
                      <td
                        key={crew.id}
                        className="p-1 border-b border-border border-l border-l-border/50 align-top"
                      >
                        {cellAppts.length > 0 ? (
                          <div className="space-y-1">
                            {cellAppts.map((a) => (
                              <AppointmentCard
                                key={a.id}
                                appointment={a}
                                crew={crew}
                                compact
                                onClick={() => setSelectedAppt(a)}
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
              );
            })}
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
