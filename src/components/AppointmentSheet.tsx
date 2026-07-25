"use client";

import { Appointment, Crew } from "@/lib/types";
import { typeLabel, timeBlockLabel } from "@/lib/calendar-utils";
import { openSalesforce, mapsHref } from "@/lib/salesforce";
import { useData } from "./DataProvider";
import {
  X,
  MapPin,
  ExternalLink,
  Calendar,
  User,
  Hash,
  Clock,
  Link2,
  Trash2,
} from "lucide-react";
import { useState } from "react";

interface Props {
  appointment: Appointment;
  onClose: () => void;
  onEdit: () => void;
}

export default function AppointmentSheet({
  appointment,
  onClose,
  onEdit,
}: Props) {
  const { crews, cancelAppointment } = useData();
  const [cancelling, setCancelling] = useState(false);

  const crew = crews.find((c) => c.id === appointment.crew_id);
  const secondaryCrew = appointment.secondary_crew_id
    ? crews.find((c) => c.id === appointment.secondary_crew_id)
    : null;

  const handleCancel = async () => {
    if (!confirm("Cancel this appointment?")) return;
    setCancelling(true);
    try {
      await cancelAppointment(appointment.id, appointment.version);
      onClose();
    } catch {
      alert("Failed to cancel. The appointment may have been modified.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative bg-background rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto animate-slide-up safe-area-bottom">
        <div className="sticky top-0 bg-background p-4 flex items-center justify-between border-b border-border z-10">
          <h2 className="text-lg font-semibold">Appointment Details</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-surface"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="text-xl font-bold">
              {appointment.customer_name}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: crew?.color || "#1a73e8" }}
              >
                {typeLabel(appointment.appointment_type)}
              </span>
              {appointment.work_order_number && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200">
                  <Link2 size={10} />
                  Linked
                </span>
              )}
            </div>
          </div>

          <InfoRow icon={<User size={16} />} label="Crew">
            {crew?.name || "Unknown"}
            {secondaryCrew && ` + ${secondaryCrew.name}`}
          </InfoRow>

          <InfoRow icon={<Calendar size={16} />} label="Date">
            {appointment.scheduled_date}
            {appointment.duration_days > 1 &&
              ` (${appointment.duration_days} days)`}
          </InfoRow>

          <InfoRow icon={<Clock size={16} />} label="Time">
            {appointment.time_block
              ? timeBlockLabel(appointment.time_block)
              : `${appointment.start_time} – ${appointment.end_time}`}
          </InfoRow>

          <InfoRow icon={<MapPin size={16} />} label="Address">
            <a
              href={mapsHref(appointment.address)}
              target="_blank"
              rel="noopener"
              className="text-primary underline"
            >
              {appointment.address}
            </a>
          </InfoRow>

          {appointment.order_number && (
            <InfoRow icon={<Hash size={16} />} label="Order">
              {appointment.order_number}
            </InfoRow>
          )}

          {appointment.work_order_number && (
            <InfoRow icon={<Hash size={16} />} label="Work Order">
              <button
                onClick={() =>
                  openSalesforce(
                    appointment.work_order_number!,
                    appointment.order_number || ""
                  )
                }
                className="text-primary underline flex items-center gap-1"
              >
                {appointment.work_order_number}
                <ExternalLink size={12} />
              </button>
            </InfoRow>
          )}

          {appointment.notes && (
            <InfoRow icon={<Hash size={16} />} label="Notes">
              {appointment.notes}
            </InfoRow>
          )}

          {appointment.scheduled_by && (
            <div className="text-xs text-muted">
              Scheduled by {appointment.scheduled_by}
            </div>
          )}

          <div className="flex gap-2 pt-4 border-t border-border">
            <button
              onClick={onEdit}
              className="flex-1 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90"
            >
              Edit
            </button>
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="px-4 py-2.5 bg-danger text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-muted mt-0.5">{icon}</div>
      <div>
        <div className="text-xs text-muted">{label}</div>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}
