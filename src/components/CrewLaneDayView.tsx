"use client";

import { useState, useMemo } from "react";
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
  checkDiscrepancy,
  timeBlockStartEnd,
} from "@/lib/calendar-utils";
import { getTimeOffForDate, createAppointmentEvent } from "@/lib/store";
import { crewHasType, sortByFirstName, getEligibleCrews } from "@/lib/crew-utils";
import RForceDetailSheet from "./RForceDetailSheet";
import { Palmtree, MapPinned, Ban } from "lucide-react";
import { format } from "date-fns";
import { getCrewAvailability } from "@/lib/availability";
import { getDraggedAppointment, setDraggedAppointment, getDraggedOrder, setDraggedOrder } from "@/lib/drag-context";
import { useToast } from "./Toast";
import dynamic from "next/dynamic";

const SectionMap = dynamic(() => import("./SectionMap"), { ssr: false });

interface Props {
  date: Date;
  filterType?: AppointmentType | "all";
  showRForce?: boolean;
}

export default function CrewLaneDayView({
  date,
  filterType = "all",
  showRForce = false,
}: Props) {
  const {
    crews, appointments, rforceOrders, timeOffRequests,
    availabilityRules, availabilityExceptions, activeLinks,
    resourceMappings, dismissals, approveRForce, dismissRForce,
    updateAppointment,
  } = useData();
  const { showToast } = useToast();
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    crewId: string;
    block: TimeBlock;
    prefill?: RForceOrder;
  } | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [reschedulingAppt, setReschedulingAppt] = useState<Appointment | null>(null);
  const [selectedRForce, setSelectedRForce] = useState<{
    order: RForceOrder;
    crew?: Crew;
    displayItem?: RForceDisplayItem;
  } | null>(null);

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

  const activeCrews = crews.filter((c) => c.is_active);

  const mainCrews = activeCrews.filter((c) => !crewHasType(c, "misc", "second", "management"));

  const measureCrews = sortByFirstName(mainCrews.filter((c) => crewHasType(c, "measure_tech")));
  const installCrews = sortByFirstName(mainCrews.filter((c) => crewHasType(c, "install_in_house", "install_sub")));
  const jipCrews = sortByFirstName(mainCrews.filter((c) => crewHasType(c, "jip")));
  const serviceCrews = sortByFirstName(mainCrews.filter((c) => crewHasType(c, "svc")));

  const managementCrews = activeCrews.filter((c) => c.crew_type === "management");
  const measureManagers = sortByFirstName(managementCrews.filter((c) => c.manages?.includes("measure")));
  const installManagers = sortByFirstName(managementCrews.filter((c) => c.manages?.includes("install")));
  const serviceManagers = sortByFirstName(managementCrews.filter((c) => c.manages?.includes("service")));
  const jipManagers = sortByFirstName(managementCrews.filter((c) => c.manages?.includes("jip")));

  const secondCrews = activeCrews.filter((c) => c.crew_type === "second");
  const installSeconds = sortByFirstName(secondCrews.filter((c) => {
    const primary = activeCrews.find((p) => p.id === c.primary_crew_id);
    return primary && (primary.crew_type === "install_in_house" || primary.crew_type === "install_sub");
  }));
  const jipSeconds = sortByFirstName(secondCrews.filter((c) => {
    const primary = activeCrews.find((p) => p.id === c.primary_crew_id);
    return primary && primary.crew_type === "jip";
  }));

  async function handleAppointmentDrop(appointmentId: string, targetCrewId: string, startTime?: string, endTime?: string) {
    const appt = appointments.find((a) => a.id === appointmentId);
    if (!appt) return;

    const crewChanged = appt.crew_id !== targetCrewId;
    const timeChanged = startTime && (startTime !== appt.start_time || endTime !== appt.end_time);
    if (!crewChanged && !timeChanged) return;

    const targetCrew = crews.find((c) => c.id === targetCrewId);
    if (!targetCrew) return;

    const eligible = getEligibleCrews(crews, appt.appointment_type);
    if (!eligible.find((c) => c.id === targetCrewId)) {
      showToast(`${targetCrew.name} cannot handle ${appt.appointment_type.replace(/_/g, " ")} appointments`, "error");
      return;
    }

    let manualOverride = appt.manual_override;
    let overrideSource = appt.override_source;

    if (appt.work_order_number) {
      const rf = rforceOrders.find((r) => r.work_order_number === appt.work_order_number);
      if (rf && rf.scheduled_start) {
        const rfDate = rf.scheduled_start.slice(0, 10);
        const rfResource = rf.primary_resource || rf.tech_measure_name || rf.installer || rf.service_rep;
        if ((crewChanged && rfResource && targetCrew.name.toLowerCase() !== rfResource.toLowerCase()) || timeChanged) {
          manualOverride = true;
          overrideSource = {
            crew_name: rfResource || undefined,
            scheduled_date: rfDate,
            time_block: appt.time_block || undefined,
          };
        } else if (!crewChanged || (rfResource && targetCrew.name.toLowerCase() === rfResource.toLowerCase())) {
          manualOverride = false;
          overrideSource = null;
        }
      }
    }

    const updates: Partial<Appointment> = {};
    if (crewChanged) updates.crew_id = targetCrewId;
    if (startTime) updates.start_time = startTime;
    if (endTime) updates.end_time = endTime;
    if (manualOverride !== undefined) updates.manual_override = manualOverride;
    if (overrideSource !== undefined) updates.override_source = overrideSource;

    try {
      await updateAppointment(appt.id, appt.version, updates);

      createAppointmentEvent({
        appointment_id: appt.id,
        action: "drag_moved",
        actor_id: null,
        actor_name_snapshot: null,
        before_state: { crew_id: appt.crew_id, start_time: appt.start_time, end_time: appt.end_time },
        after_state: { crew_id: targetCrewId, start_time: startTime || appt.start_time, end_time: endTime || appt.end_time },
        reason: null,
      });

      const parts: string[] = [];
      if (crewChanged) parts.push(targetCrew.name);
      if (timeChanged) parts.push(`${startTime}–${endTime}`);
      showToast(`Moved to ${parts.join(", ")}`, "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg === "VERSION_CONFLICT") {
        showToast("Someone else just updated this appointment — please try again", "warning");
      } else {
        showToast(`Failed to move: ${msg}`, "error");
      }
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      {(filterType === "all" || filterType === "tech_measure") &&
        measureCrews.length > 0 && (
          <CrewSection
            title="Measure Techs"
            crews={measureCrews}
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
          />
        )}

      {(filterType === "all" || filterType === "tech_measure") &&
        measureManagers.length > 0 && (
          <CrewSection
            title="Measure Management"
            crews={measureManagers}
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
          />
        )}

      {/* Install management bridge, then install + seconds */}
      {(filterType === "all" || filterType === "install") &&
        installManagers.length > 0 && (
          <CrewSection
            title="Install Management"
            crews={installManagers}
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
          />
        )}
      {(filterType === "all" || filterType === "install") &&
        installCrews.length > 0 && (
          <CrewSection
            title="Install"
            crews={installCrews}
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
          />
        )}
      {(filterType === "all" || filterType === "install") &&
        installSeconds.length > 0 && (
          <CrewSection
            title="Install Seconds"
            crews={installSeconds}
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
          />
        )}

      {/* Service section + management */}
      {(filterType === "all" || filterType === "service") &&
        serviceCrews.length > 0 && (
          <CrewSection
            title="Service"
            crews={serviceCrews}
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
          />
        )}
      {(filterType === "all" || filterType === "service") &&
        serviceManagers.length > 0 && (
          <CrewSection
            title="Service Management"
            crews={serviceManagers}
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
          />
        )}

      {/* JIP section + seconds + management */}
      {(filterType === "all" || filterType === "jip") &&
        jipCrews.length > 0 && (
          <CrewSection
            title="JIP"
            crews={jipCrews}
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
          />
        )}
      {(filterType === "all" || filterType === "jip") &&
        jipSeconds.length > 0 && (
          <CrewSection
            title="JIP Seconds"
            crews={jipSeconds}
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
          />
        )}
      {(filterType === "all" || filterType === "jip") &&
        jipManagers.length > 0 && (
          <CrewSection
            title="JIP Management"
            crews={jipManagers}
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
          />
        )}

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
          onClose={() => setSelectedRForce(null)}
          onApprove={
            selectedRForce.displayItem?.displayMode === "approval"
              ? async () => {
                  const item = selectedRForce.displayItem!;
                  await approveRForce(
                    item.rforceOrder,
                    item.crewId,
                    item.timeBlock,
                    item.rforceOrder.scheduled_start?.slice(0, 10) || dateStr
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
  onApproveRForce: (rforceOrder: RForceOrder, crewId: string, timeBlock: TimeBlock, scheduledDate: string) => Promise<Appointment | null>;
  onDismissRForce: (workOrderNumber: string, rforceDate: string, rforceStartTime?: string) => Promise<void>;
  onAppointmentDrop?: (appointmentId: string, targetCrewId: string, startTime?: string, endTime?: string) => void;
  onQueueDrop?: (order: RForceOrder, crewId: string) => void;
}) {
  const [showMap, setShowMap] = useState(false);
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

              const [wsH, wsM] = avail.workStart.split(":").map(Number);
              const [weH, weM] = avail.workEnd.split(":").map(Number);
              const crewWorkStart = wsH + (wsM || 0) / 60;
              const crewWorkEnd = weH + (weM || 0) / 60;
              const crewOffLeft = ((Math.max(crewWorkStart, TIMELINE_START) - TIMELINE_START) / TIMELINE_HOURS) * 100;
              const crewOffRight = ((TIMELINE_END - Math.min(crewWorkEnd, TIMELINE_END)) / TIMELINE_HOURS) * 100;

              const hasAnyContent = crewAppts.length > 0 || crewApprovals.length > 0;
              const hasRForceContent = showRForce && (crewRForceVisible.length > 0 || crewApprovals.length > 0);
              const twoLayer = hasRForceContent;

              function handleRowDragOver(e: React.DragEvent) {
                const dragged = getDraggedAppointment();
                const order = getDraggedOrder();
                if (!dragged && !order) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverCrewId !== crew.id) setDragOverCrewId(crew.id);
              }
              function handleRowDragLeave() {
                if (dragOverCrewId === crew.id) setDragOverCrewId(null);
              }
              function handleRowDrop(e: React.DragEvent) {
                e.preventDefault();
                setDragOverCrewId(null);
                const dragged = getDraggedAppointment();
                if (dragged) {
                  // Calculate drop time from mouse X position on the timeline
                  const rect = e.currentTarget.getBoundingClientRect();
                  const xPct = ((e.clientX - rect.left) / rect.width) * 100;
                  const dropHour = TIMELINE_START + (xPct / 100) * TIMELINE_HOURS;

                  // Snap to nearest half-hour
                  const snappedHour = Math.round(dropHour * 2) / 2;
                  const h = Math.floor(snappedHour);
                  const m = (snappedHour - h) * 60;
                  const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

                  // Keep original duration
                  const origAppt = dragged.appointment;
                  const [origSH, origSM] = (origAppt.start_time || "08:00").split(":").map(Number);
                  const [origEH, origEM] = (origAppt.end_time || "16:00").split(":").map(Number);
                  const durationMins = (origEH * 60 + origEM) - (origSH * 60 + origSM);
                  const endMins = h * 60 + m + durationMins;
                  const eH = Math.floor(endMins / 60);
                  const eM = endMins % 60;
                  const endTime = `${String(Math.min(eH, 23)).padStart(2, "0")}:${String(eM).padStart(2, "0")}`;

                  onAppointmentDrop?.(dragged.appointment.id, crew.id, startTime, endTime);
                  setDraggedAppointment(null);
                  return;
                }

                // Queue item drop — open ScheduleModal prefilled with rForce order
                const order = getDraggedOrder();
                if (order) {
                  onQueueDrop?.(order, crew.id);
                  setDraggedOrder(null);
                }
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
                <div key={crew.id} className={`flex border-b border-border ${off ? "bg-amber-100/60 dark:bg-amber-900/30" : crewUnavailable ? "bg-muted/5" : ""}`}>
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
                    {!off && !crewUnavailable && crew.notes && (
                      <div className="text-[10px] text-muted font-normal mt-0.5 pl-[18px]">{crew.notes}</div>
                    )}
                    {off && (
                      <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 mt-0.5 pl-[18px]">Time Off</div>
                    )}
                    {!off && crewUnavailable && (
                      <div className="text-[10px] text-muted/50 mt-0.5 pl-[18px]">{avail.reason || "Unavailable"}</div>
                    )}
                  </div>
                  {twoLayer ? (
                    /* Two-layer layout: rForce on top, app on bottom */
                    <div className="flex-1 flex flex-col min-w-0">
                      {/* rForce layer (top) */}
                      <div className="relative min-h-[44px] border-b border-dashed border-border/50">
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
                              className="absolute top-0.5 bottom-0.5 z-[2] overflow-hidden"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onRForceClick(rf.rforceOrder, crew, rf);
                              }}
                            >
                              <RForceCard
                                order={rf.rforceOrder}
                                crew={crew}
                                compact={false}
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
                              className="absolute top-0.5 bottom-0.5 z-[3] overflow-hidden"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ApprovalCard
                                rforceOrder={item.rforceOrder}
                                crew={crew}
                                onApprove={async () => {
                                  await onApproveRForce(item.rforceOrder, item.crewId, item.timeBlock, rfDate);
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
                        className={`relative min-h-[44px] cursor-pointer transition-colors ${dragOverCrewId === crew.id ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""}`}
                        onClick={() => onCellClick(crew.id, "full_day")}
                        onDragOver={handleRowDragOver}
                        onDragLeave={handleRowDragLeave}
                        onDrop={handleRowDrop}
                      >
                        {renderGridlines()}
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
                              className="absolute top-0.5 bottom-0.5 z-[2] cursor-grab active:cursor-grabbing"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", a.id);
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
                              }}
                              onClick={(e) => { e.stopPropagation(); onCardClick(a); }}
                            >
                              <div className="relative h-full overflow-hidden">
                                <AppointmentCard
                                  appointment={a}
                                  crew={crew}
                                  compact={false}
                                  hasDiscrepancy={!!discItem || checkDiscrepancy(a, rforceOrders)}
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
                      className={`flex-1 relative min-h-[90px] cursor-pointer transition-colors ${dragOverCrewId === crew.id ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""}`}
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
                      {renderGridlines()}
                      {/* Time-off overlay */}
                      {off && !hasAnyContent && (
                        <div className="absolute inset-0 bg-amber-200/40 dark:bg-amber-800/20 flex items-center justify-center z-[1]">
                          <Palmtree size={14} className="text-amber-500/50 dark:text-amber-400/40" />
                        </div>
                      )}
                      {/* Unavailable overlay */}
                      {!off && crewUnavailable && !hasAnyContent && (
                        <div className="absolute inset-0 bg-muted/8 flex items-center justify-center z-[1]">
                          <Ban size={14} className="text-muted/25" />
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
                            className="absolute top-1 bottom-1 z-[2] cursor-grab active:cursor-grabbing"
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", a.id);
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
                            }}
                            onClick={(e) => { e.stopPropagation(); onCardClick(a); }}
                          >
                            <div className="relative h-full overflow-hidden">
                              <AppointmentCard
                                appointment={a}
                                crew={crew}
                                compact={false}
                                hasDiscrepancy={!!discItem || checkDiscrepancy(a, rforceOrders)}
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
                            className="absolute top-1 bottom-1 z-[3] overflow-hidden"
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ApprovalCard
                              rforceOrder={item.rforceOrder}
                              crew={crew}
                              onApprove={async () => {
                                await onApproveRForce(item.rforceOrder, item.crewId, item.timeBlock, rfDate);
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
