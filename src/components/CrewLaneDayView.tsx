"use client";

import { useState, useMemo } from "react";
import { useData } from "./DataProvider";
import AppointmentCard from "./AppointmentCard";
import RForceCard from "./RForceCard";
import AppointmentSheet from "./AppointmentSheet";
import ScheduleModal from "./ScheduleModal";
import {
  Appointment,
  Crew,
  CrewType,
  TimeBlock,
  RForceOrder,
  AppointmentType,
} from "@/lib/types";
import {
  getAppointmentsForCrewAndDay,
  getRForceItemsForDay,
  checkDiscrepancy,
  RForceCalendarItem,
} from "@/lib/calendar-utils";
import { getTimeOffForDate } from "@/lib/store";
import { openSalesforce } from "@/lib/salesforce";
import { Plus, Palmtree, MapPinned } from "lucide-react";
import { format } from "date-fns";
import dynamic from "next/dynamic";

const SectionMap = dynamic(() => import("./SectionMap"), { ssr: false });

interface Props {
  date: Date;
  filterType?: AppointmentType | "all";
}

export default function CrewLaneDayView({
  date,
  filterType = "all",
}: Props) {
  const { crews, appointments, rforceOrders, timeOffRequests } = useData();
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    crewId: string;
    block: TimeBlock;
  } | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);

  const dateStr = format(date, "yyyy-MM-dd");
  const offToday = useMemo(
    () => getTimeOffForDate(timeOffRequests, dateStr),
    [timeOffRequests, dateStr]
  );

  const offNames = useMemo(() => {
    return new Set(offToday.map((r) => r.employee_name.toLowerCase()));
  }, [offToday]);

  const rforceItems = useMemo(
    () => getRForceItemsForDay(rforceOrders, appointments, crews, date),
    [rforceOrders, appointments, crews, date]
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

  function crewHasType(crew: Crew, ...types: CrewType[]): boolean {
    if (types.includes(crew.crew_type)) return true;
    if (crew.additional_types) {
      return crew.additional_types.some((t) => types.includes(t));
    }
    return false;
  }

  const mainCrews = activeCrews.filter((c) => !crewHasType(c, "misc", "second", "management"));

  const measureCrews = mainCrews.filter((c) => crewHasType(c, "measure_tech"));
  const installCrews = mainCrews.filter((c) => crewHasType(c, "install_in_house", "install_sub"));
  const jipCrews = mainCrews.filter((c) => crewHasType(c, "jip"));
  const serviceCrews = mainCrews.filter((c) => crewHasType(c, "svc"));

  const managementCrews = activeCrews.filter((c) => c.crew_type === "management");
  const measureManagers = managementCrews.filter((c) => c.manages?.includes("measure"));
  const installManagers = managementCrews.filter((c) => c.manages?.includes("install"));
  const serviceManagers = managementCrews.filter((c) => c.manages?.includes("service"));
  const jipManagers = managementCrews.filter((c) => c.manages?.includes("jip"));

  const secondCrews = activeCrews.filter((c) => c.crew_type === "second");
  const installSeconds = secondCrews.filter((c) => {
    const primary = activeCrews.find((p) => p.id === c.primary_crew_id);
    return primary && (primary.crew_type === "install_in_house" || primary.crew_type === "install_sub");
  });
  const jipSeconds = secondCrews.filter((c) => {
    const primary = activeCrews.find((p) => p.id === c.primary_crew_id);
    return primary && primary.crew_type === "jip";
  });

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
            rforceItems={rforceItems}
            isCrewOff={isCrewOff}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
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
            rforceItems={rforceItems}
            isCrewOff={isCrewOff}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
          />
        )}

      {/* Install section + seconds + management */}
      {(filterType === "all" || filterType === "install") &&
        installCrews.length > 0 && (
          <CrewSection
            title="Install"
            crews={installCrews}
            date={date}
            appointments={appointments}
            rforceOrders={rforceOrders}
            rforceItems={rforceItems}
            isCrewOff={isCrewOff}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
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
            rforceItems={rforceItems}
            isCrewOff={isCrewOff}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
          />
        )}
      {(filterType === "all" || filterType === "install") &&
        installManagers.length > 0 && (
          <CrewSection
            title="Install Management"
            crews={installManagers}
            date={date}
            appointments={appointments}
            rforceOrders={rforceOrders}
            rforceItems={rforceItems}
            isCrewOff={isCrewOff}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
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
            rforceItems={rforceItems}
            isCrewOff={isCrewOff}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
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
            rforceItems={rforceItems}
            isCrewOff={isCrewOff}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
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
            rforceItems={rforceItems}
            isCrewOff={isCrewOff}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
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
            rforceItems={rforceItems}
            isCrewOff={isCrewOff}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
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
            rforceItems={rforceItems}
            isCrewOff={isCrewOff}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
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
        />
      )}

      {scheduleTarget && (
        <ScheduleModal
          date={date}
          crewId={scheduleTarget.crewId}
          timeBlock={scheduleTarget.block}
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
    </div>
  );
}

function CrewSection({
  title,
  crews,
  date,
  appointments,
  rforceOrders,
  rforceItems,
  isCrewOff,
  onCardClick,
  onCellClick,
}: {
  title: string;
  crews: Crew[];
  date: Date;
  appointments: Appointment[];
  rforceOrders: RForceOrder[];
  rforceItems: RForceCalendarItem[];
  isCrewOff: (crew: Crew) => boolean;
  onCardClick: (a: Appointment) => void;
  onCellClick: (crewId: string, block: TimeBlock) => void;
}) {
  const [showMap, setShowMap] = useState(false);

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
        <div className={`${showMap ? "flex-1 min-w-0" : "w-full"}`}>
          {crews.map((crew) => {
            const off = isCrewOff(crew);
            const crewAppts = getAppointmentsForCrewAndDay(
              appointments,
              crew.id,
              date
            ).sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));

            const crewRForce = rforceItems.filter((r) => r.crewId === crew.id);
            const hasContent = crewAppts.length > 0 || crewRForce.length > 0;

            return (
              <div
                key={crew.id}
                className={`flex items-stretch border-b border-border ${off ? "bg-amber-100/60 dark:bg-amber-900/30" : ""}`}
              >
                <div className={`w-36 shrink-0 p-2 text-xs font-medium ${off ? "bg-amber-100 dark:bg-amber-900/40" : "bg-background"}`}>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`w-3 h-3 rounded-full shrink-0 ${off ? "opacity-40" : ""}`}
                      style={{ backgroundColor: crew.color }}
                    />
                    <span className={off ? "opacity-60 line-through" : ""}>{crew.name}</span>
                    {off && (
                      <Palmtree size={14} className="text-amber-500 dark:text-amber-400 shrink-0" />
                    )}
                  </div>
                  {!off && crew.notes && (
                    <div className="text-[10px] text-muted font-normal mt-0.5 pl-[18px]">
                      {crew.notes}
                    </div>
                  )}
                  {off && (
                    <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 mt-0.5 pl-[18px]">
                      Time Off
                    </div>
                  )}
                </div>
                <div className="flex-1 p-1 min-h-[52px]">
                  {off && !hasContent ? (
                    <div className="w-full h-full rounded-lg bg-amber-200/60 dark:bg-amber-800/25 border border-dashed border-amber-400/60 dark:border-amber-600/40 flex items-center justify-center">
                      <Palmtree size={14} className="text-amber-500/70 dark:text-amber-400/60" />
                    </div>
                  ) : hasContent ? (
                    <div className="flex gap-1.5 overflow-x-auto items-start">
                      {crewAppts.map((a) => (
                        <div key={a.id} className="shrink-0 w-[200px]">
                          <AppointmentCard
                            appointment={a}
                            crew={crew}
                            compact
                            hasDiscrepancy={checkDiscrepancy(a, rforceOrders)}
                            onClick={() => onCardClick(a)}
                          />
                        </div>
                      ))}
                      {crewRForce.map((rf) => (
                        <div key={rf.rforceOrder.work_order_number} className="shrink-0 w-[200px]">
                          <RForceCard
                            order={rf.rforceOrder}
                            crew={crew}
                            compact
                            onClick={() =>
                              openSalesforce(
                                rf.rforceOrder.work_order_number,
                                rf.rforceOrder.order_number
                              )
                            }
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => onCellClick(crew.id, "full_day")}
                        className="shrink-0 w-10 h-10 rounded-lg border border-dashed border-border/50 hover:border-primary hover:bg-primary-light/30 transition-colors flex items-center justify-center group"
                      >
                        <Plus size={14} className="text-muted/30 group-hover:text-primary" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onCellClick(crew.id, "full_day")}
                      className="w-full h-full min-h-[44px] rounded-lg border border-dashed border-border/50 hover:border-primary hover:bg-primary-light/30 transition-colors flex items-center justify-center group"
                    >
                      <Plus size={14} className="text-muted/30 group-hover:text-primary" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
