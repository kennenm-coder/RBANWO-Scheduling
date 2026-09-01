"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
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
import { checkAvailabilityConflict } from "@/lib/availability";
import { getEligibleCrews } from "@/lib/crew-utils";
import {
  getSchedulingMode,
  isFixedBlock,
  isTimed,
  isFullDay,
  getDefaultTimes,
  resolveScheduleTimes,
  deriveOccupancy,
  addMinutesToTime,
  timeDurationMinutes,
  SchedulingMode,
} from "@/lib/scheduling-policy";
import { fetchAccountSuggestions, AccountSuggestion, createAppointmentEvent } from "@/lib/store";
import { executeScheduleMove } from "@/lib/schedule-command";
import OverlapOverrideDialog from "./OverlapOverrideDialog";
import { deriveTimesFromOrder } from "@/lib/rforce-times";
import { useData } from "./DataProvider";
import { useCurrentActor } from "./AuthProvider";
import { X, AlertTriangle, AlertCircle, MapPin, ChevronDown, ChevronRight, Users } from "lucide-react";
import { format } from "date-fns";

interface Props {
  date: Date;
  crewId?: string;
  timeBlock?: TimeBlock;
  prefill?: RForceOrder;
  editingAppointment?: Appointment;
  rescheduleMode?: boolean;
  initialStartTime?: string;
  initialEndTime?: string;
  /** Queue-tile occupancy carried through a drag/drop or Schedule click. */
  initialResourceHours?: number | null;
  initialIsFullDay?: boolean;
  onClose: () => void;
}

export default function ScheduleModal({
  date,
  crewId,
  timeBlock: initialTimeBlock,
  prefill,
  editingAppointment,
  rescheduleMode,
  initialStartTime,
  initialEndTime,
  initialResourceHours,
  initialIsFullDay,
  onClose,
}: Props) {
  const {
    crews,
    appointments,
    rforceOrders,
    timeOffRequests,
    availabilityRules,
    availabilityExceptions,
    calendarBlocks,
    createAppointment,
    updateAppointment,
  } = useData();
  const { actorId, actorName } = useCurrentActor();
  useEscapeKey(useCallback(() => onClose(), [onClose]));

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
  // When scheduling straight from an rForce order, seed the block/start/end from
  // the order's real scheduled window instead of the full_day default (which
  // stamped queued jobs with an all-day 08:00–16:00 bar).
  const prefillTimes = prefill
    ? deriveTimesFromOrder(prefill.scheduled_start, prefill.scheduled_end, deriveAppointmentType())
    : null;
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
    editingAppointment?.time_block || initialTimeBlock || prefillTimes?.time_block || "full_day"
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
  // Parse additional crew members from notes (stored as "[Resources: Name, Name]" prefix)
  function parseAdditionalMembers(notesStr: string | null): { members: string; cleanNotes: string } {
    if (!notesStr) return { members: "", cleanNotes: "" };
    const match = notesStr.match(/^\[Resources: ([^\]]*)\]\s*/);
    if (match) return { members: match[1], cleanNotes: notesStr.slice(match[0].length) };
    return { members: "", cleanNotes: notesStr };
  }
  const parsed = parseAdditionalMembers(editingAppointment?.notes || "");
  const [additionalMembers, setAdditionalMembers] = useState(parsed.members);
  const [notes, setNotes] = useState(parsed.cleanNotes);
  const [showResources, setShowResources] = useState(
    !!(editingAppointment?.secondary_crew_id || editingAppointment?.tertiary_crew_id || parsed.members)
  );
  // Explicit start/end for timed types (service, JIP, etc.)
  const timedDefaults = getDefaultTimes(type);
  const seededStart =
    initialStartTime || editingAppointment?.start_time || prefillTimes?.start_time || timedDefaults.start;
  const [startTime, setStartTime] = useState(seededStart);
  const [endTime, setEndTime] = useState(
    initialEndTime ||
      editingAppointment?.end_time ||
      prefillTimes?.end_time ||
      // Queue-tile hours (when no explicit end was passed) drive the initial window.
      (initialResourceHours && initialResourceHours > 0
        ? addMinutesToTime(seededStart, Math.round(initialResourceHours * 60))
        : timedDefaults.end)
  );
  const schedulingMode = getSchedulingMode(type);
  // The full-day checkbox. Measures are never full-day; installs default checked,
  // timed types (service/JIP/…) default unchecked. Editing seeds from the record.
  const [isFullDayChecked, setIsFullDayChecked] = useState<boolean>(
    editingAppointment
      ? !!(editingAppointment.is_full_day ?? editingAppointment.time_block === "full_day")
      : (initialIsFullDay ?? schedulingMode === "full_day")
  );
  // A measure is always block-based; anything else obeys the checkbox.
  const wantsFullDay = schedulingMode !== "fixed_block" && isFullDayChecked;
  // Resource hours (the calendar occupancy). Two-way with start/end below.
  const resourceHours = Math.max(0, Math.round((timeDurationMinutes(startTime, endTime) / 60) * 100) / 100);
  const setResourceHours = (h: number) => {
    if (!(h > 0)) return;
    setEndTime(addMinutesToTime(startTime, Math.round(h * 60)));
  };
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // When a reschedule/move lands on an already-booked slot, holds the conflict
  // sentence so the scheduler can confirm an intentional overlap (retries the
  // save with allow_overlap). Only reachable when editing an existing appt.
  const [overlapPrompt, setOverlapPrompt] = useState<string | null>(null);
  // Holds the availability-block sentence when a save would land on PTO / an
  // Unavailable rule / a Late or Office day. The scheduler must tick the
  // override box to proceed, mirroring the double-booking flow.
  const [availabilityPrompt, setAvailabilityPrompt] = useState<string | null>(null);
  const [availabilityOverridden, setAvailabilityOverridden] = useState(false);

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

  // A confirmed availability override applies only to the target it was granted
  // for — re-arm the gate whenever the crew, date, block, or span changes.
  useEffect(() => {
    setAvailabilityOverridden(false);
  }, [selectedCrewId, selectedDate, selectedBlock, durationDays]);

  // When the appointment type changes, reset the full-day checkbox to that type's
  // default (install → checked, timed → unchecked). Skip the first render so an
  // edited appointment keeps the value seeded from its record.
  const typeInitRef = useRef(type);
  useEffect(() => {
    if (typeInitRef.current === type) return;
    typeInitRef.current = type;
    setIsFullDayChecked(getSchedulingMode(type) === "full_day");
  }, [type]);

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
    await doSave(false);
  };

  // `allowOverlap` is set only by the overlap-override confirmation, letting an
  // edit/reschedule intentionally double-book an already-occupied slot.
  // `bypassAvailability` is set once the availability-block override is confirmed.
  const doSave = async (allowOverlap: boolean, bypassAvailability = false) => {
    if (!selectedCrewId || !customerName || !address) return;
    if (rescheduleMode && !rescheduleReason.trim()) {
      setError("A reason is required when rescheduling.");
      return;
    }

    setSaving(true);
    setError("");

    // Resolve times from the scheduling mode AND the full-day checkbox. Measures
    // are block-based; everyone else is full-day (checkbox on) or timed (off).
    // time_block is measure-only + "full_day" — a timed job never carries a block.
    let start: string;
    let end: string;
    let resolvedBlock: TimeBlock | null;
    if (schedulingMode === "fixed_block") {
      const resolved = resolveScheduleTimes(type, { timeBlock: selectedBlock });
      start = resolved.start;
      end = resolved.end;
      resolvedBlock = resolved.timeBlock ?? selectedBlock;
    } else if (wantsFullDay) {
      start = startTime || "08:00";
      end = "16:00";
      resolvedBlock = "full_day";
    } else {
      start = startTime;
      end = endTime;
      resolvedBlock = null;
    }
    const occupancy = deriveOccupancy({
      timeBlock: resolvedBlock,
      startTime: start,
      endTime: end,
      fullDay: wantsFullDay,
    });

    // Availability gate — scheduling onto PTO / an Unavailable rule / a Late or
    // Office day requires an explicit override, just like double-booking.
    if (!bypassAvailability && !availabilityOverridden) {
      const block = checkAvailabilityConflict(
        selectedCrewId,
        selectedDate,
        parseInt(durationDays) || 1,
        resolvedBlock,
        editingAppointment?.time_block_end ?? null,
        availabilityRules,
        availabilityExceptions,
        calendarBlocks
      );
      if (block) {
        const crewName = selectedCrew?.name || "This crew";
        setAvailabilityPrompt(
          block.fullDay
            ? `${crewName} is ${block.reason} on ${block.date} (whole day blocked).`
            : `${crewName} is ${block.reason} during this time on ${block.date}.`
        );
        setSaving(false);
        return;
      }
    }

    const salesforceUrl = workOrderNumber
      ? buildSalesforceUrl(workOrderNumber)
      : null;

    // Merge additional crew members into notes
    const membersPrefix = additionalMembers.trim() ? `[Resources: ${additionalMembers.trim()}] ` : "";
    const combinedNotes = (membersPrefix + (notes || "")).trim() || null;

    try {
      if (editingAppointment) {
        const nonSchedulingUpdates: Partial<Appointment> = {
          secondary_crew_id: secondaryCrewId || null,
          tertiary_crew_id: tertiaryCrewId || null,
          appointment_type: type,
          customer_name: customerName,
          address,
          order_number: orderNumber || null,
          work_order_number: workOrderNumber || null,
          product_count: productCount ? parseInt(productCount) : null,
          notes: combinedNotes,
          salesforce_url: salesforceUrl,
          ...(rescheduleMode ? { reschedule_reason: rescheduleReason.trim() } : {}),
        };

        // Scheduling and descriptive fields are committed in one optimistic
        // update. This prevents a move from succeeding while the accompanying
        // customer/resource edits fail (or vice versa).
        const moveResult = await executeScheduleMove(
          {
            appointmentId: editingAppointment.id,
            expectedVersion: editingAppointment.version,
            crewId: selectedCrewId,
            scheduledDate: selectedDate,
            timeBlock: resolvedBlock,
            startTime: start,
            endTime: end,
            isFullDay: wantsFullDay,
            resourceHours: occupancy.resource_hours,
            durationDays: parseInt(durationDays) || 1,
            allowOverlap,
            allowAvailabilityConflict: bypassAvailability || availabilityOverridden,
            additionalUpdates: nonSchedulingUpdates,
            auditAction: rescheduleMode ? "rescheduled" : "updated",
            reason: rescheduleMode ? rescheduleReason.trim() : null,
          },
          editingAppointment,
          appointments,
          crews,
          rforceOrders,
          updateAppointment,
          { id: actorId, name: actorName },
          availabilityRules,
          availabilityExceptions,
          calendarBlocks
        );
        if (!moveResult.ok) {
          // Offer an intentional-overlap override rather than a dead-end error.
          if (moveResult.error.code === "SCHEDULING_CONFLICT" && !allowOverlap) {
            setOverlapPrompt(moveResult.error.message);
          } else if (moveResult.error.code === "AVAILABILITY_CONFLICT") {
            setAvailabilityPrompt(moveResult.error.message);
          } else {
            setError(moveResult.error.message);
          }
          setSaving(false);
          return;
        }
      } else {
        const result = await createAppointment({
          crew_id: selectedCrewId,
          secondary_crew_id: secondaryCrewId || null,
          tertiary_crew_id: tertiaryCrewId || null,
          appointment_type: type,
          scheduled_date: selectedDate,
          start_time: start,
          end_time: end,
          time_block: resolvedBlock,
          is_full_day: occupancy.is_full_day,
          resource_hours: occupancy.resource_hours,
          duration_days: parseInt(durationDays) || 1,
          customer_name: customerName,
          address,
          order_number: orderNumber || null,
          work_order_number: workOrderNumber || null,
          product_count: productCount ? parseInt(productCount) : null,
          notes: combinedNotes,
          salesforce_url: salesforceUrl,
          status: "scheduled",
          reschedule_reason: null,
          scheduled_by: actorId || null,
          merge_source_wo: null,
          // Tag when the scheduler knowingly booked over a blocked availability
          // window so the availability_conflict flag is suppressed.
          allow_availability_conflict: bypassAvailability || availabilityOverridden,
          // Capture immutable snapshot of manual entry for later reconciliation
          original_entry_snapshot: captureOriginalEntry({
            customer_name: customerName,
            address,
            scheduled_date: selectedDate,
            crew_id: selectedCrewId,
            time_block: resolvedBlock,
            start_time: start,
            notes: notes || null,
            appointment_type: type,
          }),
        });
        // Log audit event
        if (result) {
          createAppointmentEvent({
            appointment_id: result.id,
            action: "created",
            actor_id: actorId,
            actor_name_snapshot: actorName,
            before_state: null,
            after_state: {
              customer_name: customerName,
              scheduled_date: selectedDate,
              crew_id: selectedCrewId,
              time_block: resolvedBlock,
            },
            reason: null,
          });
        }
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "DOUBLE_BOOK") {
        setError("This crew is already booked for this time block.");
      } else if (msg === "VERSION_CONFLICT") {
        setError(
          "This appointment was modified by someone else. Please close and try again."
        );
      } else if (msg.includes("SCHEDULING_CONFLICT")) {
        setError(msg.replace("SCHEDULING_CONFLICT: ", ""));
      } else if (msg.includes("DUPLICATE_WO")) {
        setError("A work order with this number is already scheduled.");
      } else {
        setError(msg || "Failed to save. Please try again.");
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
                  const newType = e.target.value as AppointmentType;
                  setType(newType);
                  const blocks = getTimeBlocksForType(newType);
                  setSelectedBlock(blocks[0]);
                  // Reset times to defaults for the new type
                  const defaults = getDefaultTimes(newType);
                  setStartTime(defaults.start);
                  setEndTime(defaults.end);
                }}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              >
                <option value="tech_measure">Tech Measure</option>
                <option value="install">Install</option>
                <option value="service">Service</option>
                <option value="jip">JIP</option>
                <option value="job_site_visit">Job Site Visit</option>
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
            {/* Mode-aware time selection */}
            {schedulingMode === "fixed_block" && (
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
            )}
            {/* Full-day toggle — everyone except measures. Installs default on,
                timed types default off; either can be flipped. */}
            {schedulingMode !== "fixed_block" && (
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none self-end pb-2">
                <input
                  type="checkbox"
                  checked={isFullDayChecked}
                  onChange={(e) => setIsFullDayChecked(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Full day
              </label>
            )}
            {wantsFullDay && (
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
          </div>

          {/* Timed placement: explicit start/end + resource hours (two-way). */}
          {schedulingMode !== "fixed_block" && !wantsFullDay && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">
                  Start Time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  step="1800"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">
                  End Time
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  step="1800"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">
                  Hours
                </label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={resourceHours || ""}
                  onChange={(e) => setResourceHours(parseFloat(e.target.value))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                />
              </div>
            </div>
          )}

          {/* Duration for non-full-day timed service jobs spanning >1 day is rare;
              keep the multi-day input available on the full-day branch above. */}

          {/* ── Additional Resources ── */}
          <div className="border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowResources(!showResources)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground hover:bg-surface transition-colors"
            >
              <Users size={14} className="text-muted" />
              Additional Resources
              {(secondaryCrewId || tertiaryCrewId || additionalMembers) && (
                <span className="ml-auto text-[10px] bg-primary/10 text-primary rounded-full px-1.5 py-0.5">
                  {[secondaryCrewId, tertiaryCrewId].filter(Boolean).length + (additionalMembers ? 1 : 0)}
                </span>
              )}
              {showResources ? <ChevronDown size={14} className="ml-auto text-muted" /> : <ChevronRight size={14} className="ml-auto text-muted" />}
            </button>
            {showResources && (
              <div className="border-t border-border px-3 py-3 space-y-3 bg-surface/30">
                <div>
                  <label className="block text-xs text-muted mb-1">
                    Lead Installer #2
                  </label>
                  <select
                    value={secondaryCrewId}
                    onChange={(e) => setSecondaryCrewId(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                  >
                    <option value="">— None —</option>
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
                    Lead Installer #3
                  </label>
                  <select
                    value={tertiaryCrewId}
                    onChange={(e) => setTertiaryCrewId(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                  >
                    <option value="">— None —</option>
                    {crews
                      .filter((c) => c.is_active && c.id !== selectedCrewId && c.id !== secondaryCrewId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">
                    Additional Crew Members
                  </label>
                  <input
                    type="text"
                    value={additionalMembers}
                    onChange={(e) => setAdditionalMembers(e.target.value)}
                    placeholder="e.g. John Smith, Mike Jones"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted mt-1">
                    Names of helpers or secondary crew members not listed as lead installers
                  </p>
                </div>
              </div>
            )}
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

      {overlapPrompt !== null && (
        <OverlapOverrideDialog
          message={overlapPrompt}
          onConfirm={async () => {
            setOverlapPrompt(null);
            await doSave(true);
          }}
          onCancel={() => setOverlapPrompt(null)}
        />
      )}

      {availabilityPrompt !== null && (
        <OverlapOverrideDialog
          title="Crew is blocked off"
          intro="This lands on a blocked window:"
          checkboxLabel="Yes, schedule over this block on purpose."
          message={availabilityPrompt}
          onConfirm={async () => {
            setAvailabilityPrompt(null);
            setAvailabilityOverridden(true);
            await doSave(false, true);
          }}
          onCancel={() => setAvailabilityPrompt(null)}
        />
      )}
    </div>
  );
}
