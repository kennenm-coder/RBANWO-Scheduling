"use client";

import { useState, useEffect, useRef } from "react";
import {
  Appointment,
  AppointmentType,
  CrewType,
  TimeBlock,
  RForceOrder,
} from "@/lib/types";
import { normalizeWoType } from "@/lib/normalize";
import { captureOriginalEntry } from "@/lib/sync-transitions";
import {
  getTimeBlocksForType,
  timeBlockLabel,
  timeBlockStartEnd,
  typeLabel,
} from "@/lib/calendar-utils";
import { buildSalesforceUrl } from "@/lib/salesforce";
import { validateAppointment } from "@/lib/scheduling-rules";
import { getEligibleCrews } from "@/lib/crew-utils";
import { fetchAccountSuggestions, AccountSuggestion } from "@/lib/store";
import { useData } from "./DataProvider";
import { X, AlertTriangle, AlertCircle, MapPin } from "lucide-react";
import { format } from "date-fns";

interface Props {
  date: Date;
  crewId?: string;
  timeBlock?: TimeBlock;
  prefill?: RForceOrder;
  editingAppointment?: Appointment;
  rescheduleMode?: boolean;
  onClose: () => void;
}

export default function ScheduleModal({
  date,
  crewId,
  timeBlock: initialTimeBlock,
  prefill,
  editingAppointment,
  rescheduleMode,
  onClose,
}: Props) {
  const {
    crews,
    appointments,
    timeOffRequests,
    createAppointment,
    updateAppointment,
  } = useData();

  // Derive appointment type: editing > prefill rForce type > target crew type > tech_measure
  function deriveAppointmentType(): AppointmentType {
    if (editingAppointment?.appointment_type) return editingAppointment.appointment_type;
    // Use the canonical normalizer for rForce work_order_type (handles JIP, LSWP, Paint/Stain, etc.)
    if (prefill?.work_order_type) {
      const normalized = normalizeWoType(prefill.work_order_type);
      if (normalized) return normalized;
    }
    // Derive from the target crew's type when clicking a crew row directly
    if (crewId) {
      const targetCrew = crews.find((c) => c.id === crewId);
      if (targetCrew) {
        const CREW_TO_APPT: Partial<Record<CrewType, AppointmentType>> = {
          measure_tech: "tech_measure",
          install_in_house: "install",
          install_sub: "install",
          jip: "jip",
          svc: "service",
        };
        const mapped = CREW_TO_APPT[targetCrew.crew_type];
        if (mapped) return mapped;
      }
    }
    return "tech_measure";
  }
  const [type, setType] = useState<AppointmentType>(deriveAppointmentType);
  const [selectedCrewId, setSelectedCrewId] = useState(
    editingAppointment?.crew_id || crewId || ""
  );
  const [secondaryCrewId, setSecondaryCrewId] = useState(
    editingAppointment?.secondary_crew_id || ""
  );
  const [tertiaryCrewId, setTertiaryCrewId] = useState(
    editingAppointment?.tertiary_crew_id || ""
  );
  const [selectedDate, setSelectedDate] = useState(
    editingAppointment?.scheduled_date || format(date, "yyyy-MM-dd")
  );
  const [selectedBlock, setSelectedBlock] = useState<TimeBlock>(
    editingAppointment?.time_block || initialTimeBlock || "full_day"
  );
  const [customerName, setCustomerName] = useState(
    editingAppointment?.customer_name || prefill?.customer_name || ""
  );
  const [address, setAddress] = useState(
    editingAppointment?.address || prefill?.address || ""
  );
  const [orderNumber, setOrderNumber] = useState(
    editingAppointment?.order_number || prefill?.order_number || ""
  );
  const [workOrderNumber, setWorkOrderNumber] = useState(
    editingAppointment?.work_order_number ||
      prefill?.work_order_number ||
      ""
  );
  const [productCount, setProductCount] = useState(
    editingAppointment?.product_count?.toString() ||
      prefill?.product_count?.toString() ||
      ""
  );
  const [durationDays, setDurationDays] = useState(
    editingAppointment?.duration_days?.toString() || "1"
  );
  const [notes, setNotes] = useState(
    editingAppointment?.notes || ""
  );
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [accountSuggestions, setAccountSuggestions] = useState<AccountSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const addressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!prefill && !editingAppointment && !suggestionsLoaded) {
      fetchAccountSuggestions().then((s) => {
        setAccountSuggestions(s);
        setSuggestionsLoaded(true);
      });
    }
  }, [prefill, editingAppointment, suggestionsLoaded]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (addressRef.current && !addressRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredSuggestions = address.length >= 2
    ? accountSuggestions
        .filter((s) => s.address.toLowerCase().includes(address.toLowerCase()))
        .slice(0, 8)
    : [];

  const handleSelectSuggestion = (s: AccountSuggestion) => {
    setAddress(s.address);
    if (!customerName && s.customer_name) {
      setCustomerName(s.customer_name);
    }
    setShowSuggestions(false);
  };

  const timeBlocks = getTimeBlocksForType(type);
  const eligibleCrews = getEligibleCrews(crews, type);
  const otherCrews = crews.filter((c) => c.is_active && !eligibleCrews.some((e) => e.id === c.id));
  const selectedCrew = crews.find((c) => c.id === selectedCrewId);

  const dayAppts = appointments.filter(
    (a) =>
      a.scheduled_date === selectedDate &&
      a.status !== "cancelled" &&
      a.id !== editingAppointment?.id
  );

  const validation = selectedCrew
    ? validateAppointment(
        {
          id: editingAppointment?.id,
          appointment_type: type,
          time_block: selectedBlock,
          product_count: productCount ? parseInt(productCount) : null,
          crew_id: selectedCrewId,
          scheduled_date: selectedDate,
        },
        dayAppts,
        selectedCrew,
        crews,
        timeOffRequests
      )
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCrewId || !customerName || !address) return;
    if (rescheduleMode && !rescheduleReason.trim()) {
      setError("A reason is required when rescheduling.");
      return;
    }

    setSaving(true);
    setError("");

    const { start, end } = timeBlockStartEnd(selectedBlock);
    const salesforceUrl = workOrderNumber
      ? buildSalesforceUrl(workOrderNumber)
      : null;

    try {
      if (editingAppointment) {
        await updateAppointment(
          editingAppointment.id,
          editingAppointment.version,
          {
            crew_id: selectedCrewId,
            secondary_crew_id: secondaryCrewId || null,
            tertiary_crew_id: tertiaryCrewId || null,
            appointment_type: type,
            scheduled_date: selectedDate,
            start_time: start,
            end_time: end,
            time_block: selectedBlock,
            duration_days: parseInt(durationDays) || 1,
            customer_name: customerName,
            address,
            order_number: orderNumber || null,
            work_order_number: workOrderNumber || null,
            product_count: productCount ? parseInt(productCount) : null,
            notes: notes || null,
            salesforce_url: salesforceUrl,
            ...(rescheduleMode ? {
              reschedule_reason: rescheduleReason.trim(),
              status: "rescheduled" as const,
            } : {}),
          }
        );
      } else {
        await createAppointment({
          crew_id: selectedCrewId,
          secondary_crew_id: secondaryCrewId || null,
          tertiary_crew_id: tertiaryCrewId || null,
          appointment_type: type,
          scheduled_date: selectedDate,
          start_time: start,
          end_time: end,
          time_block: selectedBlock,
          duration_days: parseInt(durationDays) || 1,
          customer_name: customerName,
          address,
          order_number: orderNumber || null,
          work_order_number: workOrderNumber || null,
          product_count: productCount ? parseInt(productCount) : null,
          notes: notes || null,
          salesforce_url: salesforceUrl,
          status: "scheduled",
          reschedule_reason: null,
          scheduled_by: null,
          merge_source_wo: null,
          // Capture immutable snapshot of manual entry for later reconciliation
          original_entry_snapshot: captureOriginalEntry({
            customer_name: customerName,
            address,
            scheduled_date: selectedDate,
            crew_id: selectedCrewId,
            time_block: selectedBlock,
            start_time: start,
            notes: notes || null,
            appointment_type: type,
          }),
        });
      }
      onClose();
    } catch (err: any) {
      if (err.message === "DOUBLE_BOOK") {
        setError("This crew is already booked for this time block.");
      } else if (err.message === "VERSION_CONFLICT") {
        setError(
          "This appointment was modified by someone else. Please close and try again."
        );
      } else {
        setError("Failed to save. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative bg-background rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up safe-area-bottom">
        <div className="sticky top-0 bg-background p-4 flex items-center justify-between border-b border-border z-10">
          <h2 className="text-lg font-semibold">
            {rescheduleMode ? "Reschedule Appointment" : editingAppointment ? "Edit Appointment" : "New Appointment"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-surface"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as AppointmentType);
                  const blocks = getTimeBlocksForType(
                    e.target.value as AppointmentType
                  );
                  setSelectedBlock(blocks[0]);
                }}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              >
                <option value="tech_measure">Tech Measure</option>
                <option value="install">Install</option>
                <option value="service">Service</option>
                <option value="jip">JIP</option>
                <option value="lswp">LSWP</option>
                <option value="hoa">HOA</option>
                <option value="paint_stain">Paint/Stain</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">
                Crew
              </label>
              <select
                value={selectedCrewId}
                onChange={(e) => setSelectedCrewId(e.target.value)}
                required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              >
                <option value="">Select crew...</option>
                {eligibleCrews.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {otherCrews.length > 0 && (
                  <optgroup label="Other (override)">
                    {otherCrews.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">
                Time Block
              </label>
              <select
                value={selectedBlock}
                onChange={(e) =>
                  setSelectedBlock(e.target.value as TimeBlock)
                }
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              >
                {timeBlocks.map((b) => (
                  <option key={b} value={b}>
                    {timeBlockLabel(b)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {type !== "tech_measure" && (
            <div>
              <label className="block text-xs text-muted mb-1">
                Duration (days)
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">
                Second
              </label>
              <select
                value={secondaryCrewId}
                onChange={(e) => setSecondaryCrewId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              >
                <option value="">None</option>
                {crews
                  .filter((c) => c.is_active && c.id !== selectedCrewId && c.id !== tertiaryCrewId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">
                Third / Helper
              </label>
              <select
                value={tertiaryCrewId}
                onChange={(e) => setTertiaryCrewId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              >
                <option value="">None</option>
                {crews
                  .filter((c) => c.is_active && c.id !== selectedCrewId && c.id !== secondaryCrewId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">
              Customer Name
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
            />
          </div>

          <div ref={addressRef} className="relative">
            <label className="block text-xs text-muted mb-1">
              Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => { if (address.length >= 2) setShowSuggestions(true); }}
              required
              autoComplete="off"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filteredSuggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSelectSuggestion(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-surface flex items-start gap-2 border-b border-border/50 last:border-b-0"
                  >
                    <MapPin size={12} className="shrink-0 mt-0.5 text-muted" />
                    <div className="min-w-0">
                      <div className="truncate">{s.address}</div>
                      {s.customer_name && (
                        <div className="text-[10px] text-muted truncate">{s.customer_name}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">
                Order #
              </label>
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">
                Work Order #
              </label>
              <input
                type="text"
                value={workOrderNumber}
                onChange={(e) => setWorkOrderNumber(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">
                Products
              </label>
              <input
                type="number"
                value={productCount}
                onChange={(e) => setProductCount(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none"
            />
          </div>

          {validation && validation.warnings.length > 0 && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 space-y-1">
              {validation.warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-yellow-800 dark:text-yellow-200"
                >
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {validation && validation.errors.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-1">
              {validation.errors.map((e, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-red-800 dark:text-red-200"
                >
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {e}
                </div>
              ))}
            </div>
          )}

          {rescheduleMode && (
            <div>
              <label className="block text-xs text-muted mb-1">
                Reschedule Reason <span className="text-danger">*</span>
              </label>
              <textarea
                value={rescheduleReason}
                onChange={(e) => setRescheduleReason(e.target.value)}
                placeholder="e.g. Customer requested different date, crew conflict..."
                required
                rows={2}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none"
              />
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || (validation?.errors.length || 0) > 0}
            className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : rescheduleMode
                ? "Reschedule Appointment"
                : editingAppointment
                  ? "Update Appointment"
                  : "Schedule Appointment"}
          </button>
        </form>
      </div>
    </div>
  );
}
