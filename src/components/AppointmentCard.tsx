"use client";

import { useState } from "react";
import { Appointment, Crew } from "@/lib/types";
import { typeLabel, formatProductBreakdown } from "@/lib/calendar-utils";
import { parseCity } from "@/lib/crew-utils";
import { useData } from "./DataProvider";
import { MapPin, Unlink, AlertTriangle, CheckCircle, Undo2, Users } from "lucide-react";

interface Props {
  appointment: Appointment;
  crew?: Crew;
  allCrews?: Crew[];
  compact?: boolean;
  hasDiscrepancy?: boolean;
  orderAlerts?: string | null;
  accountName?: string | null;
  isLinked?: boolean;
  showRForce?: boolean;
  onClick?: () => void;
}

export default function AppointmentCard({
  appointment,
  crew,
  allCrews,
  compact,
  hasDiscrepancy,
  orderAlerts,
  accountName,
  isLinked,
  showRForce,
  onClick,
}: Props) {
  const { unscheduleAppointment } = useData();
  const [unscheduling, setUnscheduling] = useState(false);
  const bgColor = crew?.color || "#1a73e8";

  const handleUnschedule = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (unscheduling) return;
    if (!confirm(`Unschedule ${appointment.customer_name}? It will return to the queue.`)) return;
    setUnscheduling(true);
    try {
      await unscheduleAppointment(appointment.id, appointment.version, "Unscheduled from calendar");
    } catch {
      alert("Failed to unschedule. The appointment may have been modified.");
    } finally {
      setUnscheduling(false);
    }
  };
  const city = parseCity(appointment.address);

  const helpers: string[] = [];
  if (appointment.secondary_crew_id && allCrews) {
    const sec = allCrews.find((c) => c.id === appointment.secondary_crew_id);
    if (sec) helpers.push(sec.name.split(" ")[0]);
  }
  if (appointment.tertiary_crew_id && allCrews) {
    const ter = allCrews.find((c) => c.id === appointment.tertiary_crew_id);
    if (ter) helpers.push(ter.name.split(" ")[0]);
  }
  // Parse additional crew members from notes "[Resources: Name, Name]"
  const additionalMembers = appointment.notes?.match(/^\[Resources: ([^\]]*)\]/)?.[1] || "";

  return (
    <div
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Open ${appointment.customer_name} appointment` : undefined}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
      className={`group/card relative rounded-lg p-2 cursor-pointer hover:shadow-md transition-shadow text-white text-xs leading-tight overflow-hidden ${hasDiscrepancy ? "border-l-4 border-amber-400" : ""}`}
      style={{ backgroundColor: bgColor }}
    >
      {/* Unschedule button — visible on hover */}
      <button
        onClick={handleUnschedule}
        disabled={unscheduling}
        className="absolute top-1 right-1 p-1 rounded-full bg-black/30 hover:bg-red-600 text-white opacity-0 group-hover/card:opacity-100 transition-opacity z-10"
        title="Unschedule — return to queue"
        aria-label="Unschedule appointment"
      >
        <Undo2 size={12} className={unscheduling ? "animate-spin" : ""} />
      </button>
      {hasDiscrepancy && (
        <div className="flex items-start gap-1 bg-amber-400/30 text-amber-100 rounded px-1.5 py-0.5 mb-1 text-[10px] leading-snug font-semibold">
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span>rForce mismatch — data changed since scheduling</span>
        </div>
      )}
      {orderAlerts && (
        <div className="flex items-start gap-1 bg-yellow-400/30 text-yellow-100 rounded px-1.5 py-0.5 mb-1 text-[10px] leading-snug">
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span className="line-clamp-2">{orderAlerts}</span>
        </div>
      )}
      <div className="font-semibold truncate flex items-center gap-1 pr-5">
        {appointment.customer_name}
        {!appointment.work_order_number && (
          <Unlink size={10} className="shrink-0 opacity-70" />
        )}
        {showRForce && isLinked && !hasDiscrepancy && (
          <span title="In sync with rForce"><CheckCircle size={10} className="shrink-0 text-green-300" /></span>
        )}
      </div>
      {accountName && (
        <div className="truncate opacity-80 text-[10px] leading-snug">{accountName}</div>
      )}
      {compact ? (
        <div className="truncate opacity-85 mt-0.5">
          {city}
          {(helpers.length > 0 || additionalMembers) && (
            <span className="opacity-70"> +{[...helpers, ...(additionalMembers ? [additionalMembers] : [])].join(", ")}</span>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 mt-0.5 opacity-90">
            <MapPin size={10} />
            <span className="truncate">{appointment.address}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="opacity-80">
              {typeLabel(appointment.appointment_type)}
            </span>
            {formatProductBreakdown(appointment) && (
              <span className="opacity-80">
                {formatProductBreakdown(appointment)}
              </span>
            )}
          </div>
          {(helpers.length > 0 || additionalMembers) && (
            <div className="mt-0.5 flex items-center gap-1 opacity-85 text-[10px]">
              <Users size={9} className="shrink-0" />
              <span className="truncate">
                {helpers.length > 0 && `+${helpers.join(", ")}`}
                {helpers.length > 0 && additionalMembers && " · "}
                {additionalMembers}
              </span>
            </div>
          )}
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
