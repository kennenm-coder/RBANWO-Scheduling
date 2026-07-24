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

          const measureCount = dayAppts.filter(
            (a) => a.appointment_type === "tech_measure"
          ).length;
          const installCount = dayAppts.filter(
            (a) =>
              a.appointment_type === "install" ||
              a.appointment_type === "jip" ||
              a.appointment_type === "service"
          ).length;

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
                <div className="flex gap-0.5 mt-1">
                  {measureCount > 0 && (
                    <span className="text-[9px] bg-measure text-white rounded px-1">
                      {measureCount}M
                    </span>
                  )}
                  {installCount > 0 && (
                    <span className="text-[9px] bg-install text-white rounded px-1">
                      {installCount}I
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
