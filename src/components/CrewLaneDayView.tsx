"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useData } from "./DataProvider";
import AppointmentCard from "./AppointmentCard";
import RForceCard from "./RForceCard";
import ApprovalCard from "./ApprovalCard";
import DiscrepancyBadge from "./DiscrepancyBadge";
import AppointmentSheet from "./AppointmentSheet";
import ScheduleModal from "./ScheduleModal";
import {
  Appointment,
  Crew,
  TimeBlock,
  RForceOrder,
  AppointmentType,
  AvailabilityRule,
  AvailabilityException,
  RForceDisplayItem,
} from "@/lib/types";
import {
  getAppointmentsForCrewAndDay,
  getRForceDisplayItems,
  timeBlockStartEnd,
} from "@/lib/calendar-utils";
import { deriveRForceCalendarStatus } from "@/lib/rforce-calendar-status";
import { assignTimeLanes } from "@/lib/timeline-lanes";
import { getTimeOffForDate } from "@/lib/store";
import { useCurrentActor } from "./AuthProvider";
import { crewHasType, sortByFirstName, getEligibleCrews, getDepartmentSectionsForDate } from "@/lib/crew-utils";
import { executeScheduleMove, validateMove, ScheduleMoveTarget } from "@/lib/schedule-command";
import OverlapOverrideDialog from "./OverlapOverrideDialog";
import { calculateTimelineDrag, getDurationMinutes, DAY_VIEW_SNAP_MINUTES } from "@/lib/timeline-drag";
import RForceDetailSheet from "./RForceDetailSheet";
import { Palmtree, MapPinned, Ban, Sunset, Building2 } from "lucide-react";
import { format } from "date-fns";
import { getCrewAvailability, getCrewDayLabels, LABEL_KIND_TEXT, labelForBlockingKind } from "@/lib/availability";
import { useSchedulerDrag } from "@/lib/drag-context";
import { useDragAutoScroll } from "@/lib/use-drag-autoscroll";
import { useToast } from "./Toast";
import dynamic from "next/dynamic";

const SectionMap = dynamic(() => import("./SectionMap"), { ssr: false });

interface Props {
  date: Date;
  filterType?: AppointmentType | "all";
  showRForce?: boolean;
  /** Crew to scroll to + briefly highlight (arriving from an Issues click). */
  focusCrewId?: string | null;
  onFocusHandled?: () => void;
}

export default function CrewLaneDayView({
  date,
  filterType = "all",
  showRForce = false,
  focusCrewId = null,
  onFocusHandled,
}: Props) {
  const {
    crews, appointments, rforceOrders, timeOffRequests,
    availabilityRules, availabilityExceptions, activeLinks,
    resourceMappings, dismissals, approveRForce, dismissRForce,
    updateAppointment,
  } = useData();
  const { showToast } = useToast();
  const { actorId, actorName } = useCurrentActor();
  // Auto-scroll the calendar while dragging a tile toward the top/bottom edge so
  // off-screen resources become reachable as drop targets.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { draggedAppointment: activeDrag, draggedOrder: activeOrder } = useSchedulerDrag();
  useDragAutoScroll(scrollRef, !!activeDrag || !!activeOrder);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    crewId: string;
    block: TimeBlock;
    prefill?: RForceOrder;
  } | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [reschedulingAppt, setReschedulingAppt] = useState<Appointment | null>(null);
  // A drop that landed on an already-booked slot, awaiting the scheduler's
  // confirmation to intentionally overlap. Holds the move to retry with override.
  const [pendingOverlap, setPendingOverlap] = useState<{
    target: ScheduleMoveTarget;
    appt: Appointment;
    message: string;
    successMessage: string;
  } | null>(null);
  // A drop onto a blocked availability window (PTO / Late / Office), awaiting
  // confirmation to schedule over it.
  const [pendingAvailability, setPendingAvailability] = useState<{
    target: ScheduleMoveTarget;
    appt: Appointment;
    message: string;
    successMessage: string;
  } | null>(null);
  const [selectedRForce, setSelectedRForce] = useState<{
    order: RForceOrder;
    crew?: Crew;
    displayItem?: RForceDisplayItem;
  } | null>(null);

  // Scroll to + highlight the crew row the user clicked from the Issues page.
  // Poll briefly because the day's appointments may still be loading when we
  // arrive, so the crew row might not be in the DOM on the first tick.
  useEffect(() => {
    if (!focusCrewId) return;
    let tries = 0;
    const iv = setInterval(() => {
      tries += 1;
      const el = document.querySelector<HTMLElement>(`[data-crew-row="${focusCrewId}"]`);
      if (el) {
        clearInterval(iv);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "2px solid var(--color-primary)";
        el.style.outlineOffset = "-2px";
        setTimeout(() => {
          el.style.outline = "";
          el.style.outlineOffset = "";
        }, 2600);
        onFocusHandled?.();
      } else if (tries >= 20) {
        clearInterval(iv);
        onFocusHandled?.();
      }
    }, 200);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCrewId]);

  const dateStr = format(date, "yyyy-MM-dd");
  const offToday = useMemo(
    () => getTimeOffForDate(timeOffRequests, dateStr),
    [timeOffRequests, dateStr]
  );

  const offNames = useMemo(() => {
    return new Set(offToday.map((r) => r.employee_name.toLowerCase()));
  }, [offToday]);

  const rforceDisplayItems = useMemo(
    () => getRForceDisplayItems(rforceOrders, appointments, activeLinks, crews, date, dismissals, resourceMappings),
    [rforceOrders, appointments, activeLinks, crews, date, dismissals, resourceMappings]
  );

  // New rForce adapter — derives mismatch status for linked appointments
  const rforceStatusByWO = useMemo(() => {
    const items = deriveRForceCalendarStatus(rforceOrders, appointments, activeLinks, crews, resourceMappings);
    const map = new Map<string, boolean>();
    for (const item of items) {
      if (item.status === "mismatch") {
        map.set(item.rforceOrder.work_order_number.trim().toLowerCase(), true);
      }
    }
    return map;
  }, [rforceOrders, appointments, activeLinks, crews, resourceMappings]);

  function hasMismatch(appt: Appointment): boolean {
    if (!appt.work_order_number) return false;
    return rforceStatusByWO.get(appt.work_order_number.trim().toLowerCase()) === true;
  }

  function nameMatchesTimeOff(name: string): boolean {
    const lower = name.toLowerCase();
    if (offNames.has(lower)) return true;
    const first = lower.split(" ")[0];
    const last = lower.split(" ").slice(-1)[0];
    for (const r of offToday) {
      const torFirst = r.employee_name.split(" ")[0].toLowerCase();
      const torLast = r.employee_name.split(" ").slice(-1)[0].toLowerCase();
      if (first === torFirst && last.slice(0, 4) === torLast.slice(0, 4)) return true;
    }
    return false;
  }

  function isCrewOff(crew: Crew): boolean {
    if (nameMatchesTimeOff(crew.name)) return true;
    if (crew.aliases) {
      for (const alias of crew.aliases) {
        if (nameMatchesTimeOff(alias)) return true;
      }
    }
    return false;
  }

  // Build department sections using role_assignment rules for the current date.
  // Crews with a "SVC M/W/F" or "MT T/Th" rule get moved to the correct
  // department section based on today's day of week.
  const sections = useMemo(
    () => getDepartmentSectionsForDate(crews, date, availabilityRules, availabilityExceptions),
    [crews, date, availabilityRules, availabilityExceptions]
  );

  // Run a move; on a slot conflict, stash it so the scheduler can confirm an
  // intentional overlap (which retries with allowOverlap). `override` is set only
  // by that confirmation path.
  async function runMove(
    target: ScheduleMoveTarget,
    appt: Appointment,
    successMessage: string,
    override = false,
    availabilityOverride = false
  ) {
    const result = await executeScheduleMove(
      { ...target, allowOverlap: override, allowAvailabilityConflict: availabilityOverride },
      appt,
      appointments,
      crews,
      rforceOrders,
      updateAppointment,
      { id: actorId, name: actorName },
      availabilityRules,
      availabilityExceptions
    );

    if (result.ok) {
      showToast(successMessage, "success");
    } else if (result.error.code === "SCHEDULING_CONFLICT" && !override) {
      setPendingOverlap({ target, appt, message: result.error.message, successMessage });
    } else if (result.error.code === "AVAILABILITY_CONFLICT" && !availabilityOverride) {
      setPendingAvailability({ target, appt, message: result.error.message, successMessage });
    } else {
      const severity = result.error.code === "VERSION_CONFLICT" ? "warning" : "error";
      showToast(result.error.message, severity);
    }
  }

  async function handleAppointmentDrop(appointmentId: string, targetCrewId: string, startTime?: string, endTime?: string) {
    const appt = appointments.find((a) => a.id === appointmentId);
    if (!appt) return;

    const targetCrew = crews.find((c) => c.id === targetCrewId);
    const parts: string[] = [];
    if (appt.crew_id !== targetCrewId && targetCrew) parts.push(targetCrew.name);
    if (startTime && startTime !== appt.start_time) parts.push(`${startTime}–${endTime}`);

    await runMove(
      {
        appointmentId: appt.id,
        expectedVersion: appt.version,
        crewId: targetCrewId,
        scheduledDate: dateStr,
        startTime: startTime || null,
        endTime: endTime || null,
        timeBlock: appt.time_block,
        // Day view drops land at an exact time — keep it (and re-derive the block)
        // instead of snapping a measure job back to its block start.
        exactTime: appt.time_block !== "full_day" && !!startTime,
      },
      appt,
      `Moved to ${parts.join(", ") || "new position"}`
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto">
      {sections
        .filter((s) => filterType === "all" || filterType === s.filterType)
        .map((s) => (
          <CrewSection
            key={s.key}
            title={s.title}
            crews={s.crews}
            date={date}
            appointments={appointments}
            rforceOrders={rforceOrders}
            rforceDisplayItems={rforceDisplayItems}
            isCrewOff={isCrewOff}
            availabilityRules={availabilityRules}
            availabilityExceptions={availabilityExceptions}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
            showRForce={showRForce}
            onRForceClick={(order, crew, displayItem) => setSelectedRForce({ order, crew, displayItem })}
            onApproveRForce={approveRForce}
            onDismissRForce={dismissRForce}
            onAppointmentDrop={handleAppointmentDrop}
            onQueueDrop={(order, crewId) => setScheduleTarget({ crewId, block: "full_day", prefill: order })}
            hasMismatch={hasMismatch}
          />
        ))}

      {selectedAppt && (
        <AppointmentSheet
          appointment={selectedAppt}
          onClose={() => setSelectedAppt(null)}
          onEdit={() => {
            setEditingAppt(selectedAppt);
            setSelectedAppt(null);
          }}
          onReschedule={() => {
            setReschedulingAppt(selectedAppt);
            setSelectedAppt(null);
          }}
        />
      )}

      {scheduleTarget && (
        <ScheduleModal
          date={date}
          crewId={scheduleTarget.crewId}
          timeBlock={scheduleTarget.block}
          prefill={scheduleTarget.prefill}
          onClose={() => setScheduleTarget(null)}
        />
      )}

      {editingAppt && (
        <ScheduleModal
          date={date}
          editingAppointment={editingAppt}
          onClose={() => setEditingAppt(null)}
        />
      )}

      {reschedulingAppt && (
        <ScheduleModal
          date={date}
          editingAppointment={reschedulingAppt}
          rescheduleMode
          onClose={() => setReschedulingAppt(null)}
        />
      )}

      {selectedRForce && (
        <RForceDetailSheet
          order={selectedRForce.order}
          crew={selectedRForce.crew}
          stale={selectedRForce.displayItem?.stale}
          onClose={() => setSelectedRForce(null)}
          onApprove={
            selectedRForce.displayItem?.displayMode === "approval"
              ? async (override?: boolean) => {
                  const item = selectedRForce.displayItem!;
                  await approveRForce(
                    item.rforceOrder,
                    item.crewId,
                    item.timeBlock,
                    item.rforceOrder.scheduled_start?.slice(0, 10) || dateStr,
                    override
                  );
                }
              : undefined
          }
          onDismiss={
            selectedRForce.displayItem?.displayMode === "approval"
              ? async () => {
                  const item = selectedRForce.displayItem!;
                  await dismissRForce(
                    item.rforceOrder.work_order_number,
                    item.rforceOrder.scheduled_start?.slice(0, 10) || dateStr,
                    item.rforceOrder.scheduled_start?.slice(11, 16)
                  );
                }
              : undefined
          }
        />
      )}

      {pendingOverlap && (
        <OverlapOverrideDialog
          message={pendingOverlap.message}
          onConfirm={async () => {
            const p = pendingOverlap;
            await runMove(p.target, p.appt, p.successMessage, true);
            setPendingOverlap(null);
          }}
          onCancel={() => setPendingOverlap(null)}
        />
      )}

      {pendingAvailability && (
        <OverlapOverrideDialog
          title="Crew is blocked off"
          intro="This lands on a blocked window:"
          checkboxLabel="Yes, schedule over this block on purpose."
          message={pendingAvailability.message}
          onConfirm={async () => {
            const p = pendingAvailability;
            await runMove(p.target, p.appt, p.successMessage, false, true);
            setPendingAvailability(null);
          }}
          onCancel={() => setPendingAvailability(null)}
        />
      )}
    </div>
  );
}

const TIMELINE_START = 4;
const TIMELINE_END = 22;
const TIMELINE_HOURS = TIMELINE_END - TIMELINE_START;
const WORK_START = 8;
const WORK_END = 18;

const HOUR_LABELS = Array.from({ length: TIMELINE_HOURS + 1 }, (_, i) => {
  const h = TIMELINE_START + i;
  if (h === 0 || h === 12) return "12";
  return `${h > 12 ? h - 12 : h}`;
});

function timeToPercent(time: string): number {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || "0", 10);
  return ((h + m / 60 - TIMELINE_START) / TIMELINE_HOURS) * 100;
}

function durationPercent(start: string, end: string): number {
  return timeToPercent(end) - timeToPercent(start);
}

interface DayDragPreview {
  crewId: string;
  customerName: string;
  leftPercent: number;
  widthPercent: number;
  startTime: string;
  endTime: string;
  valid: boolean;
  invalidReason?: string;
}

function CrewSection({
  title,
  crews,
  date,
  appointments,
  rforceOrders,
  rforceDisplayItems,
  isCrewOff,
  availabilityRules,
  availabilityExceptions,
  showRForce,
  onCardClick,
  onCellClick,
  onRForceClick,
  onApproveRForce,
  onDismissRForce,
  onAppointmentDrop,
  onQueueDrop,
  hasMismatch,
}: {
  title: string;
  crews: Crew[];
  date: Date;
  appointments: Appointment[];
  rforceOrders: RForceOrder[];
  rforceDisplayItems: RForceDisplayItem[];
  isCrewOff: (crew: Crew) => boolean;
  availabilityRules: AvailabilityRule[];
  availabilityExceptions: AvailabilityException[];
  showRForce?: boolean;
  onCardClick: (a: Appointment) => void;
  onCellClick: (crewId: string, block: TimeBlock) => void;
  onRForceClick: (order: RForceOrder, crew: Crew, displayItem?: RForceDisplayItem) => void;
  onApproveRForce: (rforceOrder: RForceOrder, crewId: string, timeBlock: TimeBlock, scheduledDate: string, override?: boolean) => Promise<Appointment | null>;
  onDismissRForce: (workOrderNumber: string, rforceDate: string, rforceStartTime?: string) => Promise<void>;
  onAppointmentDrop?: (appointmentId: string, targetCrewId: string, startTime?: string, endTime?: string) => void;
  onQueueDrop?: (order: RForceOrder, crewId: string) => void;
  hasMismatch: (appt: Appointment) => boolean;
}) {
  const { draggedAppointment, draggedOrder, setDraggedAppointment, setDraggedOrder } = useSchedulerDrag();
  // Minutes into the dragged card where the pointer grabbed it. Captured at
  // drag start so the drop can subtract it and the card doesn't jump when the
  // user grabs its middle or right edge.
  const grabOffsetMinutesRef = useRef(0);
  const [showMap, setShowMap] = useState(false);

  // Live drag preview: the tile-shaped placeholder shown at the snapped landing
  // spot while dragging. Only updated when the meaningful slot changes (see
  // lastPreviewKeyRef) so we don't re-render on every pixel of pointer movement.
  const [dragPreview, setDragPreview] = useState<DayDragPreview | null>(null);
  const lastPreviewKeyRef = useRef<string | null>(null);

  function clearDragPreview() {
    setDragPreview(null);
    lastPreviewKeyRef.current = null;
    grabOffsetMinutesRef.current = 0;
  }

  // Record how far into the card (in minutes) the pointer grabbed, so the drop
  // can offset by it. The card's on-screen width maps to its duration, so the
  // horizontal grab ratio × duration is the grab offset in minutes.
  function captureGrabOffset(e: React.DragEvent, appt: Appointment) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const dur = getDurationMinutes(appt.start_time || "08:00", appt.end_time || "16:00");
    grabOffsetMinutesRef.current = clampedRatio * (dur > 0 ? dur : 0);
  }
  const [dragOverCrewId, setDragOverCrewId] = useState<string | null>(null);

  const rforceByWo = useMemo(() => {
    const map = new Map<string, RForceOrder>();
    for (const rf of rforceOrders) map.set(rf.work_order_number, rf);
    return map;
  }, [rforceOrders]);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between px-4 py-2 bg-surface sticky top-0 z-10">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
          {title}
        </h3>
        <button
          onClick={() => setShowMap(!showMap)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
            showMap
              ? "bg-primary text-white"
              : "text-muted hover:bg-border hover:text-foreground"
          }`}
        >
          <MapPinned size={12} />
          Map
        </button>
      </div>
      <div className={showMap ? "flex" : ""}>
        <div className={`overflow-x-auto ${showMap ? "flex-1 min-w-0" : "w-full"}`}>
          <div className="min-w-[700px]">
            {/* Hour labels */}
            <div className="flex border-b border-border">
              <div className="w-36 shrink-0 p-2 text-xs text-muted font-medium">Crew</div>
              <div className="flex-1 relative h-7">
                {HOUR_LABELS.map((label, i) => {
                  const h = TIMELINE_START + i;
                  const pct = (i / TIMELINE_HOURS) * 100;
                  const isWorkHour = h >= WORK_START && h <= WORK_END;
                  return (
                    <div
                      key={h}
                      className="absolute top-0 h-full flex flex-col items-center"
                      style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
                    >
                      <span className={`text-[9px] font-medium ${isWorkHour ? "text-muted" : "text-muted/40"}`}>
                        {label}{h < 12 || h === 24 ? "a" : "p"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Crew rows */}
            {crews.map((crew) => {
              const off = isCrewOff(crew);
              const crewAppts = getAppointmentsForCrewAndDay(appointments, crew.id, date)
                .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
              const crewItems = rforceDisplayItems.filter((r) => r.crewId === crew.id);
              const crewApprovals = crewItems.filter((r) => r.displayMode === "approval");
              const crewDiscrepancies = crewItems.filter((r) => r.displayMode === "discrepancy");
              const crewRForceVisible = crewItems.filter((r) =>
                r.displayMode === "regular" || r.displayMode === "synced"
              );
              const avail = getCrewAvailability(crew.id, date, availabilityRules, availabilityExceptions);
              const crewUnavailable = !avail.available;
              // PTO (external time off) wins over Late/Office tags, and a full-day
              // Office/Late block is already conveyed by the row's reason line — so
              // only show the small badges when the day isn't otherwise blocked.
              const dayLabels = off || crewUnavailable
                ? []
                : getCrewDayLabels(crew.id, date, availabilityRules, availabilityExceptions);

              // Overlap-lane assignment so same-time items never draw on top of
              // each other, with per-tile heights so a card with rForce alerts
              // (extra lines) gets a taller lane instead of clipping — the crew
              // row grows to fit the tallest tile in each lane.
              const LANE_GAP = 4;
              // Tile width as % of the timeline. Below NARROW_PCT a short (1–2h)
              // tile is too skinny for the full layout, so it drops to a condensed
              // essentials-only card (name + time + city).
              const NARROW_PCT = 16;
              const tileWidthPct = (a: Appointment): number => {
                const start = a.start_time || "08:00";
                const end = a.end_time || (a.time_block === "full_day" ? "16:00" : "10:00");
                return Math.max(durationPercent(start, end), 100 / TIMELINE_HOURS);
              };
              const isNarrowTile = (a: Appointment) => tileWidthPct(a) < NARROW_PCT;
              // Estimate how much vertical room an app card needs from its content.
              const estimateAppHeight = (a: Appointment): number => {
                const widthPct = tileWidthPct(a);
                // Condensed card: p-1 padding + name + time + city.
                if (widthPct < NARROW_PCT) return 8 + 16 + 14 + 16 + 12;

                const rf = a.work_order_number ? rforceByWo.get(a.work_order_number) : undefined;
                const alertText = rf?.order_alerts || rf?.scheduler_notes || "";
                const hasAccount = !!rf?.account_name;
                const hasDisc = crewDiscrepancies.some((d) => d.linkedAppointment?.id === a.id) || hasMismatch(a);
                const hasHelpers = !!(a.secondary_crew_id || a.tertiary_crew_id || /^\[Resources:/.test(a.notes || ""));
                const wide = widthPct >= 20;
                const charsPerLine = Math.max(12, Math.round(widthPct * 0.9));
                let h = 16 + 16 + 14 + 16 + (wide ? 18 : 32); // padding + name + time + address + type/units row
                if (hasAccount) h += 15;
                if (hasDisc) h += wide ? 24 : 34;
                if (alertText) {
                  const lines = Math.min(2, Math.max(1, Math.ceil(alertText.length / charsPerLine)));
                  h += lines * 14 + 10; // clamped alert banner + its margins
                }
                if (hasHelpers) h += 15;
                if (a.duration_days > 1) h += 15;
                return h + 4; // small safety margin over clipping
              };
              const RF_H = 58;
              // Approval cards carry Approve/Dismiss buttons, so they need real
              // height or the buttons clip — size from content + width.
              const estimateApprovalHeight = (it: RForceDisplayItem): number => {
                const o = it.rforceOrder;
                const s = o.scheduled_start?.slice(11, 16) || "08:00";
                const e = o.scheduled_end?.slice(11, 16) || "10:00";
                const widthPct = Math.max(durationPercent(s, e), 100 / TIMELINE_HOURS);
                const wide = widthPct >= 20;
                // padding + name/badge + address + type/product + Approve/Dismiss row
                let h = 16 + 20 + 16 + (wide ? 18 : 34) + 40;
                if (o.account_name) h += 15;
                return h;
              };
              const apptItem = (a: Appointment) => ({
                id: a.id,
                start_time: a.start_time,
                end_time: a.end_time || (a.time_block === "full_day" ? "16:00" : null),
                height: estimateAppHeight(a),
              });
              const apprItem = (it: RForceDisplayItem) => ({
                id: `appr-${it.rforceOrder.work_order_number}`,
                start_time: it.rforceOrder.scheduled_start?.slice(11, 16),
                end_time: it.rforceOrder.scheduled_end?.slice(11, 16),
                height: estimateApprovalHeight(it),
              });
              const rfItem = (it: RForceDisplayItem) => ({
                id: `rf-${it.rforceOrder.work_order_number}`,
                start_time: it.rforceOrder.scheduled_start?.slice(11, 16),
                end_time: it.rforceOrder.scheduled_end?.slice(11, 16),
                height: RF_H,
              });
              // Pack items into lanes, then size each lane to its tallest tile and
              // stack lanes with cumulative offsets.
              const layoutLanes = (items: { id: string; start_time?: string | null; end_time?: string | null; height: number }[]) => {
                const { laneOf, laneCount } = assignTimeLanes(items);
                const laneHeights = new Array(laneCount).fill(40);
                for (const it of items) {
                  const lane = laneOf.get(it.id) ?? 0;
                  laneHeights[lane] = Math.max(laneHeights[lane], it.height);
                }
                const laneTops: number[] = [];
                let acc = 0;
                for (let i = 0; i < laneCount; i++) {
                  laneTops.push(acc);
                  acc += laneHeights[i] + LANE_GAP;
                }
                return {
                  total: Math.max(acc - LANE_GAP, 40),
                  styleFor: (id: string) => {
                    const lane = laneOf.get(id) ?? 0;
                    return { top: `${laneTops[lane]}px`, height: `${laneHeights[lane]}px` };
                  },
                };
              };
              // Single-layer: app tiles + approval cards share one timeline.
              const singleLanes = layoutLanes([...crewAppts.map(apptItem), ...crewApprovals.map(apprItem)]);
              // Two-layer: app tiles on the bottom, rForce + approvals on top.
              const appLanes = layoutLanes(crewAppts.map(apptItem));
              const rfTopLanes = layoutLanes([...crewRForceVisible.map(rfItem), ...crewApprovals.map(apprItem)]);
              const laneStyle = (layout: { total: number }) => ({ minHeight: `${layout.total}px` });
              const bandStyle = (layout: { styleFor: (id: string) => { top: string; height: string } }, id: string) =>
                layout.styleFor(id);

              const [wsH, wsM] = avail.workStart.split(":").map(Number);
              const [weH, weM] = avail.workEnd.split(":").map(Number);
              const crewWorkStart = wsH + (wsM || 0) / 60;
              const crewWorkEnd = weH + (weM || 0) / 60;
              const crewOffLeft = ((Math.max(crewWorkStart, TIMELINE_START) - TIMELINE_START) / TIMELINE_HOURS) * 100;
              const crewOffRight = ((TIMELINE_END - Math.min(crewWorkEnd, TIMELINE_END)) / TIMELINE_HOURS) * 100;

              // Partial Late/Office (and other) blocked windows: shade just the
              // affected 2-hour blocks on the timeline. Only when the crew isn't
              // fully off/unavailable (those render a full overlay instead).
              const partialBlockedRanges = (!off && !crewUnavailable)
                ? [...avail.unavailableBlocks]
                    .filter((b) => b !== "full_day")
                    .map((b) => {
                      const { start, end } = timeBlockStartEnd(b);
                      const left = timeToPercent(start);
                      return { key: b, left, width: timeToPercent(end) - left };
                    })
                    .filter((r) => r.width > 0)
                : [];

              const hasAnyContent = crewAppts.length > 0 || crewApprovals.length > 0;
              const hasRForceContent = showRForce && (crewRForceVisible.length > 0 || crewApprovals.length > 0);
              const twoLayer = hasRForceContent;

              function handleRowDragOver(e: React.DragEvent) {
                const dragged = draggedAppointment;
                const order = draggedOrder;
                if (!dragged && !order) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverCrewId !== crew.id) setDragOverCrewId(crew.id);
                // Queue orders get the lane highlight only — no tile-shaped preview.
                if (!dragged) return;

                const appt = dragged.appointment;
                const durationMins = getDurationMinutes(
                  appt.start_time || "08:00",
                  appt.end_time || "16:00"
                );
                if (!(durationMins > 0)) return;

                // Recompute against the CURRENT lane rect every move so horizontal
                // scrolling is reflected (clientX and rect.left are both viewport).
                const rect = e.currentTarget.getBoundingClientRect();
                const drag = calculateTimelineDrag({
                  pointerClientX: e.clientX,
                  laneLeft: rect.left,
                  laneWidth: rect.width,
                  timelineStartMinutes: TIMELINE_START * 60,
                  timelineEndMinutes: TIMELINE_END * 60,
                  appointmentDurationMinutes: durationMins,
                  grabOffsetMinutes: grabOffsetMinutesRef.current,
                  snapMinutes: DAY_VIEW_SNAP_MINUTES,
                });

                // Only re-render when the snapped slot (or crew/validity) changes,
                // not on every pixel — keeps dragging smooth.
                const key = `${crew.id}|${drag.startTime}|${drag.endTime}`;
                if (lastPreviewKeyRef.current === key) return;
                lastPreviewKeyRef.current = key;

                // Validate against the shared command so the preview can warn
                // (ineligible crew / conflict) before the user releases.
                let invalidReason: string | undefined;
                try {
                  const err = validateMove(
                    {
                      appointmentId: appt.id,
                      expectedVersion: appt.version,
                      crewId: crew.id,
                      scheduledDate: format(date, "yyyy-MM-dd"),
                      timeBlock: appt.time_block,
                      startTime: drag.startTime,
                      endTime: drag.endTime,
                    },
                    appt,
                    appointments,
                    crews
                  );
                  invalidReason = err?.message;
                } catch {
                  invalidReason = undefined;
                }

                setDragPreview({
                  crewId: crew.id,
                  customerName: appt.customer_name,
                  leftPercent: drag.leftPercent,
                  widthPercent: drag.widthPercent,
                  startTime: drag.startTime,
                  endTime: drag.endTime,
                  valid: !invalidReason,
                  invalidReason,
                });
              }
              function handleRowDragLeave() {
                if (dragOverCrewId === crew.id) setDragOverCrewId(null);
              }
              function handleRowDrop(e: React.DragEvent) {
                e.preventDefault();
                setDragOverCrewId(null);
                const dragged = draggedAppointment;
                if (dragged) {
                  const origAppt = dragged.appointment;
                  const durationMins = getDurationMinutes(
                    origAppt.start_time || "08:00",
                    origAppt.end_time || "16:00"
                  );

                  // A malformed / zero-length appointment can't be placed by
                  // dragging — bail rather than invent a time. (Rare; the
                  // reschedule modal is the right path for those.)
                  if (!(durationMins > 0)) {
                    setDraggedAppointment(null);
                    clearDragPreview();
                    return;
                  }

                  // Same shared math the live preview will use: subtract the
                  // grab offset so the card lands where it was picked up, snap,
                  // clamp inside the timeline, and preserve duration.
                  const rect = e.currentTarget.getBoundingClientRect();
                  const { startTime, endTime } = calculateTimelineDrag({
                    pointerClientX: e.clientX,
                    laneLeft: rect.left,
                    laneWidth: rect.width,
                    timelineStartMinutes: TIMELINE_START * 60,
                    timelineEndMinutes: TIMELINE_END * 60,
                    appointmentDurationMinutes: durationMins,
                    grabOffsetMinutes: grabOffsetMinutesRef.current,
                    snapMinutes: DAY_VIEW_SNAP_MINUTES,
                  });

                  onAppointmentDrop?.(origAppt.id, crew.id, startTime, endTime);
                  setDraggedAppointment(null);
                  clearDragPreview();
                  return;
                }

                // Queue item drop — open ScheduleModal prefilled with rForce order
                const order = draggedOrder;
                if (order) {
                  onQueueDrop?.(order, crew.id);
                  setDraggedOrder(null);
                }
                clearDragPreview();
              }

              function renderGridlines() {
                return HOUR_LABELS.map((_, i) => {
                  const h = TIMELINE_START + i;
                  const pct = (i / TIMELINE_HOURS) * 100;
                  return (
                    <div
                      key={h}
                      className={`absolute top-0 bottom-0 w-px ${h >= WORK_START && h <= WORK_END ? "bg-border/40" : "bg-border/15"}`}
                      style={{ left: `${pct}%` }}
                    />
                  );
                });
              }

              return (
                <div key={crew.id} data-crew-row={crew.id} className={`flex border-b border-border ${off ? "bg-amber-100/60 dark:bg-amber-900/30" : crewUnavailable ? "bg-muted/5" : ""}`}>
                  <div className={`w-36 shrink-0 p-2 text-xs font-medium ${off ? "bg-amber-100 dark:bg-amber-900/40" : crewUnavailable ? "bg-muted/5" : "bg-background"}`}>
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`w-3 h-3 rounded-full shrink-0 ${off || crewUnavailable ? "opacity-40" : ""}`}
                        style={{ backgroundColor: crew.color }}
                      />
                      <span className={off ? "opacity-60 line-through" : crewUnavailable ? "opacity-50" : ""}>{crew.name}</span>
                      {off && <Palmtree size={14} className="text-amber-500 dark:text-amber-400 shrink-0" />}
                      {!off && crewUnavailable && <Ban size={12} className="text-muted/40 shrink-0" />}
                    </div>
                    {dayLabels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1 pl-[18px]">
                        {dayLabels.map((k) => (
                          <span
                            key={k}
                            className={`text-[9px] font-medium px-1 py-px rounded ${
                              k === "late_day"
                                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                                : "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300"
                            }`}
                          >
                            {LABEL_KIND_TEXT[k]}
                          </span>
                        ))}
                      </div>
                    )}
                    {!off && !crewUnavailable && crew.notes && (
                      <div className="text-[10px] text-muted font-normal mt-0.5 pl-[18px]">{crew.notes}</div>
                    )}
                    {off && (
                      <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 mt-0.5 pl-[18px]">Time Off</div>
                    )}
                    {!off && crewUnavailable && (
                      <div
                        className={`text-[10px] font-semibold mt-0.5 pl-[18px] ${
                          avail.blockingKind === "late_day"
                            ? "text-amber-700 dark:text-amber-300"
                            : avail.blockingKind === "office_day"
                              ? "text-teal-700 dark:text-teal-300"
                              : "text-muted/50 font-normal"
                        }`}
                      >
                        {avail.reason || "Unavailable"}
                      </div>
                    )}
                  </div>
                  {twoLayer ? (
                    /* Two-layer layout: rForce on top, app on bottom */
                    <div className="flex-1 flex flex-col min-w-0">
                      {/* rForce layer (top) */}
                      <div className="relative min-h-[44px] border-b border-dashed border-border/50" style={laneStyle(rfTopLanes)}>
                        {renderGridlines()}
                        {crewRForceVisible.map((rf) => {
                          const startTime = rf.rforceOrder.scheduled_start?.slice(11, 16) || "08:00";
                          const endTime = rf.rforceOrder.scheduled_end?.slice(11, 16) || undefined;
                          const leftPct = timeToPercent(startTime);
                          let widthPct = endTime ? durationPercent(startTime, endTime) : 100 / TIMELINE_HOURS;
                          if (widthPct < 100 / TIMELINE_HOURS) widthPct = 100 / TIMELINE_HOURS;
                          return (
                            <div
                              key={`rf-${rf.rforceOrder.work_order_number}`}
                              className="absolute z-[2] overflow-hidden"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%`, ...bandStyle(rfTopLanes, `rf-${rf.rforceOrder.work_order_number}`) }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onRForceClick(rf.rforceOrder, crew, rf);
                              }}
                            >
                              <RForceCard
                                order={rf.rforceOrder}
                                crew={crew}
                                compact={false}
                                isSynced={rf.displayMode === "synced"}
                                onClick={() => onRForceClick(rf.rforceOrder, crew, rf)}
                              />
                            </div>
                          );
                        })}
                        {crewApprovals.map((item) => {
                          const startTime = item.rforceOrder.scheduled_start?.slice(11, 16) || "08:00";
                          const endTime = item.rforceOrder.scheduled_end?.slice(11, 16) || undefined;
                          const leftPct = timeToPercent(startTime);
                          let widthPct = endTime ? durationPercent(startTime, endTime) : 100 / TIMELINE_HOURS;
                          if (widthPct < 100 / TIMELINE_HOURS) widthPct = 100 / TIMELINE_HOURS;
                          const rfDate = item.rforceOrder.scheduled_start?.slice(0, 10) || "";
                          return (
                            <div
                              key={`appr-${item.rforceOrder.work_order_number}`}
                              className="absolute z-[3] overflow-hidden"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%`, ...bandStyle(rfTopLanes, `appr-${item.rforceOrder.work_order_number}`) }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ApprovalCard
                                rforceOrder={item.rforceOrder}
                                stale={item.stale}
                                crew={crew}
                                onApprove={async (override) => {
                                  await onApproveRForce(item.rforceOrder, item.crewId, item.timeBlock, rfDate, override);
                                }}
                                onDismiss={async () => {
                                  await onDismissRForce(
                                    item.rforceOrder.work_order_number,
                                    rfDate,
                                    item.rforceOrder.scheduled_start?.slice(11, 16)
                                  );
                                }}
                                onClick={() => onRForceClick(item.rforceOrder, crew, item)}
                              />
                            </div>
                          );
                        })}
                        {/* rForce label */}
                        <div className="absolute top-0 left-0 px-1 py-px text-[7px] text-muted/40 uppercase tracking-wide z-[1] pointer-events-none">rForce</div>
                      </div>
                      {/* App layer (bottom) */}
                      <div
                        className={`relative min-h-[44px] cursor-pointer transition-colors ${dragOverCrewId === crew.id ? "bg-primary/15 outline outline-2 outline-dashed outline-primary" : ""}`}
                        style={laneStyle(appLanes)}
                        onClick={() => onCellClick(crew.id, "full_day")}
                        onDragOver={handleRowDragOver}
                        onDragLeave={handleRowDragLeave}
                        onDrop={handleRowDrop}
                      >
                        {renderGridlines()}
                        {dragPreview && dragPreview.crewId === crew.id && (
                          <div
                            className={`pointer-events-none absolute z-[6] rounded-md border-2 border-dashed flex flex-col justify-center px-2 overflow-hidden ${dragPreview.valid ? "border-primary bg-primary/25" : "border-red-500 bg-red-500/20"}`}
                            style={{ left: `${dragPreview.leftPercent}%`, width: `${dragPreview.widthPercent}%`, top: 3, height: 40 }}
                          >
                            <span className="truncate text-[10px] font-semibold leading-tight">{dragPreview.customerName}</span>
                            <span className={`truncate text-[9px] leading-tight ${dragPreview.valid ? "text-primary/80" : "text-red-600 dark:text-red-400"}`}>
                              {dragPreview.startTime}–{dragPreview.endTime}{!dragPreview.valid && dragPreview.invalidReason ? ` · ${dragPreview.invalidReason}` : ""}
                            </span>
                          </div>
                        )}
                        {off && !hasAnyContent && (
                          <div className="absolute inset-0 bg-amber-200/40 dark:bg-amber-800/20 flex items-center justify-center z-[1]">
                            <Palmtree size={14} className="text-amber-500/50 dark:text-amber-400/40" />
                          </div>
                        )}
                        {crewAppts.map((a) => {
                          const start = a.start_time || "08:00";
                          const end = a.end_time || (a.time_block === "full_day" ? "16:00" : undefined);
                          const leftPct = timeToPercent(start);
                          let widthPct = end ? durationPercent(start, end) : 100 / TIMELINE_HOURS;
                          if (widthPct < 100 / TIMELINE_HOURS) widthPct = 100 / TIMELINE_HOURS;
                          const discItem = crewDiscrepancies.find(
                            (d) => d.linkedAppointment?.id === a.id
                          );
                          return (
                            <div
                              key={a.id}
                              className={`absolute z-[2] cursor-grab active:cursor-grabbing rounded ${draggedAppointment?.appointment.id === a.id ? "outline outline-2 outline-primary outline-offset-1" : ""}`}
                              style={{ left: `${leftPct}%`, width: `${widthPct}%`, ...bandStyle(appLanes, a.id) }}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", a.id);
                                captureGrabOffset(e, a);
                                setDraggedAppointment({
                                  appointment: a,
                                  sourceCrewId: crew.id,
                                  sourceDate: format(date, "yyyy-MM-dd"),
                                  sourceTimeBlock: a.time_block,
                                });
                                (e.currentTarget as HTMLElement).style.opacity = "0.4";
                              }}
                              onDragEnd={(e) => {
                                (e.currentTarget as HTMLElement).style.opacity = "1";
                                setDraggedAppointment(null);
                                clearDragPreview();
                              }}
                              onClick={(e) => { e.stopPropagation(); onCardClick(a); }}
                            >
                              <div className="relative h-full overflow-hidden">
                                <AppointmentCard
                                  appointment={a}
                                  crew={crew}
                                  compact={isNarrowTile(a)}
                                  hasDiscrepancy={!!discItem || hasMismatch(a)}
                                  orderAlerts={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.order_alerts || rforceByWo.get(a.work_order_number)?.scheduler_notes || null) : null}
                                  accountName={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.account_name || null) : null}
                                  isLinked={!!a.work_order_number}
                                  showRForce={showRForce}
                                  onClick={() => onCardClick(a)}
                                />
                                {discItem && (
                                  <DiscrepancyBadge
                                    differences={discItem.differences}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRForceClick(discItem.rforceOrder, crew, discItem);
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {/* App label */}
                        <div className="absolute top-0 left-0 px-1 py-px text-[7px] text-muted/40 uppercase tracking-wide z-[1] pointer-events-none">App</div>
                      </div>
                    </div>
                  ) : (
                    /* Single-layer layout (rForce off or no rForce content) */
                    <div
                      className={`flex-1 relative min-h-[90px] cursor-pointer transition-colors ${dragOverCrewId === crew.id ? "bg-primary/15 outline outline-2 outline-dashed outline-primary" : ""}`}
                      style={laneStyle(singleLanes)}
                      onClick={() => onCellClick(crew.id, "full_day")}
                      onDragOver={handleRowDragOver}
                      onDragLeave={handleRowDragLeave}
                      onDrop={handleRowDrop}
                    >
                      {/* Off-hours shading */}
                      <div
                        className="absolute top-0 bottom-0 left-0 bg-muted/5 dark:bg-muted/10 z-0"
                        style={{ width: `${crewOffLeft}%` }}
                      />
                      <div
                        className="absolute top-0 bottom-0 right-0 bg-muted/5 dark:bg-muted/10 z-0"
                        style={{ width: `${crewOffRight}%` }}
                      />
                      {/* Partial Late/Office blocked windows */}
                      {partialBlockedRanges.map((r) => (
                        <div
                          key={`blk-${r.key}`}
                          className="absolute top-0 bottom-0 z-0 bg-amber-200/25 dark:bg-amber-800/20 border-x border-amber-300/40 dark:border-amber-700/30"
                          style={{ left: `${r.left}%`, width: `${r.width}%` }}
                          title="Blocked"
                        />
                      ))}
                      {renderGridlines()}
                      {dragPreview && dragPreview.crewId === crew.id && (
                        <div
                          className={`pointer-events-none absolute z-[6] rounded-md border-2 border-dashed flex flex-col justify-center px-2 overflow-hidden ${dragPreview.valid ? "border-primary bg-primary/25" : "border-red-500 bg-red-500/20"}`}
                          style={{ left: `${dragPreview.leftPercent}%`, width: `${dragPreview.widthPercent}%`, top: 3, height: 40 }}
                        >
                          <span className="truncate text-[10px] font-semibold leading-tight">{dragPreview.customerName}</span>
                          <span className={`truncate text-[9px] leading-tight ${dragPreview.valid ? "text-primary/80" : "text-red-600 dark:text-red-400"}`}>
                            {dragPreview.startTime}–{dragPreview.endTime}{!dragPreview.valid && dragPreview.invalidReason ? ` · ${dragPreview.invalidReason}` : ""}
                          </span>
                        </div>
                      )}
                      {/* Time-off overlay */}
                      {off && !hasAnyContent && (
                        <div className="absolute inset-0 bg-amber-200/40 dark:bg-amber-800/20 flex items-center justify-center z-[1]">
                          <Palmtree size={14} className="text-amber-500/50 dark:text-amber-400/40" />
                        </div>
                      )}
                      {/* Unavailable overlay — colored + labeled for Late/Office */}
                      {!off && crewUnavailable && !hasAnyContent && (
                        <div
                          className={`absolute inset-0 flex items-center justify-center gap-1.5 z-[1] ${
                            avail.blockingKind === "late_day"
                              ? "bg-amber-200/30 dark:bg-amber-800/20"
                              : avail.blockingKind === "office_day"
                                ? "bg-teal-200/30 dark:bg-teal-800/20"
                                : "bg-muted/8"
                          }`}
                        >
                          {avail.blockingKind === "late_day" || avail.blockingKind === "office_day" ? (
                            <>
                              {avail.blockingKind === "late_day" ? (
                                <Sunset size={13} className="text-amber-500/70" />
                              ) : (
                                <Building2 size={13} className="text-teal-500/70" />
                              )}
                              <span
                                className={`text-[11px] font-semibold ${
                                  avail.blockingKind === "late_day"
                                    ? "text-amber-700 dark:text-amber-300"
                                    : "text-teal-700 dark:text-teal-300"
                                }`}
                              >
                                {avail.reason || labelForBlockingKind(avail.blockingKind)}
                              </span>
                            </>
                          ) : (
                            <Ban size={14} className="text-muted/25" />
                          )}
                        </div>
                      )}
                      {/* App appointment cards — draggable */}
                      {crewAppts.map((a) => {
                        const start = a.start_time || "08:00";
                        const end = a.end_time || (a.time_block === "full_day" ? "16:00" : undefined);
                        const leftPct = timeToPercent(start);
                        let widthPct = end ? durationPercent(start, end) : 100 / TIMELINE_HOURS;
                        if (widthPct < 100 / TIMELINE_HOURS) widthPct = 100 / TIMELINE_HOURS;
                        const discItem = crewDiscrepancies.find(
                          (d) => d.linkedAppointment?.id === a.id
                        );
                        return (
                          <div
                            key={a.id}
                            className={`absolute z-[2] cursor-grab active:cursor-grabbing rounded ${draggedAppointment?.appointment.id === a.id ? "outline outline-2 outline-primary outline-offset-1" : ""}`}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%`, ...bandStyle(singleLanes, a.id) }}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", a.id);
                              captureGrabOffset(e, a);
                              setDraggedAppointment({
                                appointment: a,
                                sourceCrewId: crew.id,
                                sourceDate: format(date, "yyyy-MM-dd"),
                                sourceTimeBlock: a.time_block,
                              });
                              (e.currentTarget as HTMLElement).style.opacity = "0.4";
                            }}
                            onDragEnd={(e) => {
                              (e.currentTarget as HTMLElement).style.opacity = "1";
                              setDraggedAppointment(null);
                              clearDragPreview();
                            }}
                            onClick={(e) => { e.stopPropagation(); onCardClick(a); }}
                          >
                            <div className="relative h-full overflow-hidden">
                              <AppointmentCard
                                appointment={a}
                                crew={crew}
                                compact={isNarrowTile(a)}
                                hasDiscrepancy={!!discItem || hasMismatch(a)}
                                orderAlerts={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.order_alerts || rforceByWo.get(a.work_order_number)?.scheduler_notes || null) : null}
                                accountName={a.work_order_number ? (rforceByWo.get(a.work_order_number)?.account_name || null) : null}
                                isLinked={!!a.work_order_number}
                                showRForce={showRForce}
                                onClick={() => onCardClick(a)}
                              />
                              {discItem && (
                                <DiscrepancyBadge
                                  differences={discItem.differences}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRForceClick(discItem.rforceOrder, crew, discItem);
                                  }}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {/* Approval cards — always visible */}
                      {crewApprovals.map((item) => {
                        const startTime = item.rforceOrder.scheduled_start?.slice(11, 16) || "08:00";
                        const endTime = item.rforceOrder.scheduled_end?.slice(11, 16) || undefined;
                        const leftPct = timeToPercent(startTime);
                        let widthPct = endTime ? durationPercent(startTime, endTime) : 100 / TIMELINE_HOURS;
                        if (widthPct < 100 / TIMELINE_HOURS) widthPct = 100 / TIMELINE_HOURS;
                        const rfDate = item.rforceOrder.scheduled_start?.slice(0, 10) || "";
                        return (
                          <div
                            key={`appr-${item.rforceOrder.work_order_number}`}
                            className="absolute z-[3] overflow-hidden"
                            style={{ left: `${leftPct}%`, width: `${widthPct}%`, ...bandStyle(singleLanes, `appr-${item.rforceOrder.work_order_number}`) }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ApprovalCard
                              rforceOrder={item.rforceOrder}
                              stale={item.stale}
                              crew={crew}
                              onApprove={async (override) => {
                                await onApproveRForce(item.rforceOrder, item.crewId, item.timeBlock, rfDate, override);
                              }}
                              onDismiss={async () => {
                                await onDismissRForce(
                                  item.rforceOrder.work_order_number,
                                  rfDate,
                                  item.rforceOrder.scheduled_start?.slice(11, 16)
                                );
                              }}
                              onClick={() => onRForceClick(item.rforceOrder, crew, item)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {showMap && (
          <div className="w-[320px] shrink-0 border-l border-border h-[300px]">
            <SectionMap date={date} crews={crews} />
          </div>
        )}
      </div>
    </div>
  );
}
