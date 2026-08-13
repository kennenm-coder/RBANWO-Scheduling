"use client";

import { useData } from "./DataProvider";
import { getWeekDays, getAppointmentsForDay } from "@/lib/calendar-utils";
import { format, isSameDay, isToday } from "date-fns";

interface Props {
  currentDate: Date;
  onDayClick: (date: Date) => void;
}

export default function WeekSummary({ currentDate, onDayClick }: Props) {
  const { appointments, crews } = useData();
  const days = getWeekDays(currentDate);

  return (
    <div className="border-b border-border bg-surface">
      <div className="grid grid-cols-7 gap-px">
        {days.map((day) => {
          const dayAppts = getAppointmentsForDay(appointments, day);
          const isSelected = isSameDay(day, currentDate);
          const today = isToday(day);

          const measureAppts = dayAppts.filter(
            (a) => a.appointment_type === "tech_measure"
          );
          const installAppts = dayAppts.filter(
            (a) =>
              a.appointment_type === "install" ||
              a.appointment_type === "jip" ||
              a.appointment_type === "service"
          );
          const measureCount = measureAppts.length;
          const installCount = installAppts.length;

          // Service/JIP appointments shown separately for scheduling clarity
          const serviceAppts = dayAppts.filter(
            (a) => a.appointment_type === "service" || a.appointment_type === "jip"
          );
          const pureInstallCount = installAppts.length - serviceAppts.length;

          return (
            <button
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`flex flex-col items-center py-2 px-1 transition-colors ${
                isSelected
                  ? "bg-primary-light"
                  : "hover:bg-background"
              }`}
            >
              <span className="text-[10px] text-muted uppercase">
                {format(day, "EEE")}
              </span>
              <span
                className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${
                  today
                    ? "bg-primary text-white"
                    : isSelected
                      ? "text-primary"
                      : ""
                }`}
              >
                {format(day, "d")}
              </span>
              {dayAppts.length > 0 && (
                <div className="flex flex-col items-center gap-0.5 mt-1">
                  <div className="flex gap-0.5">
                    {measureCount > 0 && (
                      <span className="text-[9px] bg-measure text-white rounded px-1">
                        {measureCount}M
                      </span>
                    )}
                    {pureInstallCount > 0 && (
                      <span className="text-[9px] bg-install text-white rounded px-1">
                        {pureInstallCount}I
                      </span>
                    )}
                    {serviceAppts.length > 0 && (
                      <span className="text-[9px] bg-service text-white rounded px-1">
                        {serviceAppts.length}S
                      </span>
                    )}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
