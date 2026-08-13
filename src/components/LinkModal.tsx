"use client";

import { useState, useMemo, useCallback } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useData } from "./DataProvider";
import { RForceOrder, Appointment } from "@/lib/types";
import { formatDateStr } from "@/lib/calendar-utils";
import { linkAppointment } from "@/lib/store";
import { onAppointmentLinked } from "@/lib/sync-transitions";
import { X, Search, Link2, MapPin } from "lucide-react";

interface LinkToRForceProps {
  mode: "link_to_rforce";
  appointment: Appointment;
  onClose: () => void;
}

interface LinkToAppProps {
  mode: "link_to_app";
  rforceOrder: RForceOrder;
  onClose: () => void;
}

type Props = LinkToRForceProps | LinkToAppProps;

export default function LinkModal(props: Props) {
  const { rforceOrders, appointments, activeLinks, refreshData } = useData();
  const onClose = props.onClose;
  useEscapeKey(useCallback(() => onClose(), [onClose]));
  const [search, setSearch] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  const linkedExternalKeys = useMemo(
    () => new Set(activeLinks.map((l) => l.external_key)),
    [activeLinks]
  );
  const linkedAppointmentIds = useMemo(
    () => new Set(activeLinks.map((l) => l.appointment_id)),
    [activeLinks]
  );

  const unlinkedRForceOrders = useMemo(() => {
    return rforceOrders.filter(
      (r) =>
        !linkedExternalKeys.has(r.id) &&
        r.wo_status !== "Appt Complete / Closed" &&
        r.wo_status !== "Canceled"
    );
  }, [rforceOrders, linkedExternalKeys]);

  const unlinkedAppointments = useMemo(() => {
    return appointments.filter(
      (a) => !linkedAppointmentIds.has(a.id) && a.status !== "cancelled"
    );
  }, [appointments, linkedAppointmentIds]);

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    if (props.mode === "link_to_rforce") {
      return unlinkedRForceOrders.filter(
        (r) =>
          !q ||
          (r.customer_name || "").toLowerCase().includes(q) ||
          (r.address || "").toLowerCase().includes(q) ||
          r.work_order_number.toLowerCase().includes(q) ||
          r.order_number.toLowerCase().includes(q)
      );
    } else {
      return unlinkedAppointments.filter(
        (a) =>
          !q ||
          a.customer_name.toLowerCase().includes(q) ||
          a.address.toLowerCase().includes(q)
      );
    }
  }, [search, props.mode, unlinkedRForceOrders, unlinkedAppointments]);

  async function handleLink(item: RForceOrder | Appointment) {
    setLinking(true);
    setError("");
    try {
      if (props.mode === "link_to_rforce") {
        const rf = item as RForceOrder;
        await linkAppointment(
          props.appointment.id,
          props.appointment.version,
          rf,
          rf.work_order_number === props.appointment.work_order_number ? "wo_exact" : "manual"
        );
        onAppointmentLinked(props.appointment.id, props.appointment.sync_state);
      } else {
        const appt = item as Appointment;
        await linkAppointment(
          appt.id,
          appt.version,
          props.rforceOrder,
          props.rforceOrder.work_order_number === appt.work_order_number ? "wo_exact" : "manual"
        );
        onAppointmentLinked(appt.id, appt.sync_state);
      }
      await refreshData();
      props.onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "VERSION_CONFLICT") {
        setError("This record was modified by someone else. Close and try again.");
      } else if (msg === "ALREADY_LINKED") {
        setError("This record is already linked to another appointment.");
      } else {
        setError("Failed to link. Please try again.");
      }
    } finally {
      setLinking(false);
    }
  }

  const title =
    props.mode === "link_to_rforce"
      ? "Link to rForce Record"
      : "Link to App Appointment";

  const subtitle =
    props.mode === "link_to_rforce"
      ? `Linking: ${props.appointment.customer_name}`
      : `Linking: ${props.rforceOrder.customer_name} (WO: ${props.rforceOrder.work_order_number})`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={props.onClose} />
      <div className="relative bg-background rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] flex flex-col animate-slide-up safe-area-bottom">
        <div className="sticky top-0 bg-background p-4 border-b border-border z-10 rounded-t-2xl">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Link2 size={18} />
              {title}
            </h2>
            <button
              onClick={props.onClose}
              className="p-1 rounded-full hover:bg-surface"
            >
              <X size={20} />
            </button>
          </div>
          <p className="text-xs text-muted">{subtitle}</p>
          <div className="relative mt-3">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              placeholder="Search by name, address, or WO number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-border rounded-lg text-sm bg-background"
              autoFocus
            />
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {filteredItems.length === 0 && (
            <div className="p-8 text-center text-muted text-sm">
              {search
                ? "No matching records found."
                : props.mode === "link_to_rforce"
                  ? "No unlinked rForce records available."
                  : "No unlinked app appointments available."}
            </div>
          )}
          {props.mode === "link_to_rforce"
            ? (filteredItems as RForceOrder[]).map((rf) => (
                <div
                  key={rf.work_order_number}
                  className="px-4 py-3 hover:bg-surface flex items-start justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">
                      {rf.customer_name || "Unknown"}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
                      <MapPin size={10} />
                      <span className="truncate">{rf.address}</span>
                    </div>
                    <div className="flex gap-3 text-xs text-muted mt-0.5">
                      <span className="font-medium">
                        {rf.work_order_type}
                      </span>
                      <span>WO: {rf.work_order_number}</span>
                      <span>Order: {rf.order_number}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleLink(rf)}
                    disabled={linking}
                    className="ml-2 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:opacity-90 disabled:opacity-50 shrink-0 flex items-center gap-1"
                  >
                    <Link2 size={12} />
                    Link
                  </button>
                </div>
              ))
            : (filteredItems as Appointment[]).map((appt) => (
                <div
                  key={appt.id}
                  className="px-4 py-3 hover:bg-surface flex items-start justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">
                      {appt.customer_name}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
                      <MapPin size={10} />
                      <span className="truncate">{appt.address}</span>
                    </div>
                    <div className="flex gap-3 text-xs text-muted mt-0.5">
                      <span>Date: {appt.scheduled_date ? formatDateStr(appt.scheduled_date) : "—"}</span>
                      <span>
                        {appt.appointment_type === "tech_measure"
                          ? "Tech Measure"
                          : appt.appointment_type === "install"
                            ? "Install"
                            : appt.appointment_type}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleLink(appt)}
                    disabled={linking}
                    className="ml-2 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:opacity-90 disabled:opacity-50 shrink-0 flex items-center gap-1"
                  >
                    <Link2 size={12} />
                    Link
                  </button>
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
