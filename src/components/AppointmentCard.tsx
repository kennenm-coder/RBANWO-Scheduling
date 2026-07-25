"use client";

import { Appointment, Crew } from "@/lib/types";
import { typeLabel } from "@/lib/calendar-utils";
import { MapPin, Link2 } from "lucide-react";

interface Props {
  appointment: Appointment;
  crew?: Crew;
  compact?: boolean;
  onClick?: () => void;
}

export default function AppointmentCard({
  appointment,
  crew,
  compact,
  onClick,
}: Props) {
  const bgColor = crew?.color || "#1a73e8";

  return (
    <div
      onClick={onClick}
      className="rounded-lg p-2 cursor-pointer hover:shadow-md transition-shadow text-white text-xs leading-tight overflow-hidden"
      style={{ backgroundColor: bgColor }}
    >
      <div className="font-semibold truncate flex items-center gap-1">
        {appointment.customer_name}
        {appointment.work_order_number && (
          <Link2 size={10} className="shrink-0 opacity-70" />
        )}
      </div>
      {!compact && (
        <>
          <div className="flex items-center gap-1 mt-0.5 opacity-90">
            <MapPin size={10} />
            <span className="truncate">{appointment.address}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="opacity-80">
              {typeLabel(appointment.appointment_type)}
            </span>
            {appointment.product_count && (
              <span className="opacity-80">
                {appointment.product_count} units
              </span>
            )}
          </div>
          {appointment.duration_days > 1 && (
            <div className="mt-0.5 opacity-80">
              {appointment.duration_days} day install
            </div>
          )}
        </>
      )}
    </div>
  );
}
