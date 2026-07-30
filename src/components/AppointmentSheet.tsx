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
  RotateCcw,
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
  const { crews, cancelAppointment, updateAppointment } = useData();
  const [cancelling, setCancelling] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [restoring, setRestoring] = useState(false);

  const crew = crews.find((c) => c.id === appointment.crew_id);
  const secondaryCrew = appointment.secondary_crew_id
    ? crews.find((c) => c.id === appointment.secondary_crew_id)
    : null;
  const isCancelled = appointment.status === "cancelled";

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelAppointment(appointment.id, appointment.version, cancelReason || undefined);
      onClose();
    } catch {
      alert("Failed to cancel. The appointment may have been modified.");
    } finally {
      setCancelling(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      await updateAppointment(appointment.id, appointment.version, {
        status: "scheduled",
        reschedule_reason: null,
      });
      onClose();
    } catch {
      alert("Failed to restore. The appointment may have been modified.");
    } finally {
      setRestoring(false);
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
              {isCancelled && (
                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200">
                  Cancelled
                </span>
              )}
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

          {(appointment.scheduled_by || appointment.created_at) && (
            <div className="text-xs text-muted space-y-0.5">
              {appointment.scheduled_by && (
                <div>Scheduled by {appointment.scheduled_by}</div>
              )}
              {appointment.created_at && (
                <div>Created {new Date(appointment.created_at).toLocaleDateString()}</div>
              )}
              {appointment.updated_at && appointment.updated_at !== appointment.created_at && (
                <div>Last updated {new Date(appointment.updated_at).toLocaleDateString()}</div>
              )}
              <div className="text-muted/60">v{appointment.version}</div>
            </div>
          )}

          {isCancelled ? (
            <div className="pt-4 border-t border-border space-y-3">
              {appointment.reschedule_reason && (
                <div className="text-sm text-muted">
                  <span className="font-medium">Cancel reason:</span> {appointment.reschedule_reason}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleRestore}
                  disabled={restoring}
                  className="flex-1 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <RotateCcw size={16} />
                  Restore
                </button>
              </div>
            </div>
          ) : showCancelForm ? (
            <div className="pt-4 border-t border-border space-y-3">
              <label className="block text-sm font-medium">
                Cancel reason (optional)
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Customer rescheduled, weather..."
                  className="mt-1 w-full px-3 py-2 border border-border rounded-lg bg-background text-sm resize-none"
                  rows={2}
                  autoFocus
                />
              </label>
              <div className="flex gap-2">
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="flex-1 py-2.5 bg-danger text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {cancelling ? "Cancelling..." : "Confirm Cancel"}
                </button>
                <button
                  onClick={() => setShowCancelForm(false)}
                  className="px-4 py-2.5 border border-border rounded-lg font-medium hover:bg-surface"
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 pt-4 border-t border-border">
              <button
                onClick={onEdit}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90"
              >
                Edit
              </button>
              <button
                onClick={() => setShowCancelForm(true)}
                className="px-4 py-2.5 bg-danger text-white rounded-lg font-medium hover:opacity-90"
              >
                <Trash2 size={16} />
              </button>
            </div>
          )}
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
