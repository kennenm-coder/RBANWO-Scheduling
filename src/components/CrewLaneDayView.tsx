"use client";

import { useState } from "react";
import { useData } from "./DataProvider";
import AppointmentCard from "./AppointmentCard";
import AppointmentSheet from "./AppointmentSheet";
import ScheduleModal from "./ScheduleModal";
import {
  Appointment,
  Crew,
  TimeBlock,
  AppointmentType,
} from "@/lib/types";
import {
  getAppointmentsForCrewAndDay,
  MEASURE_TIME_BLOCKS,
  INSTALL_TIME_BLOCKS,
  timeBlockLabel,
} from "@/lib/calendar-utils";
import { Plus } from "lucide-react";

interface Props {
  date: Date;
  filterType?: AppointmentType | "all";
}

export default function CrewLaneDayView({
  date,
  filterType = "all",
}: Props) {
  const { crews, appointments } = useData();
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    crewId: string;
    block: TimeBlock;
  } | null>(null);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);

  const filteredCrews = crews.filter((c) => {
    if (filterType === "all") return true;
    if (filterType === "tech_measure") return c.crew_type === "measure_tech";
    if (filterType === "install")
      return (
        c.crew_type === "install_in_house" || c.crew_type === "install_sub"
      );
    if (filterType === "service") return c.crew_type === "svc";
    if (filterType === "jip") return c.crew_type === "jip";
    return true;
  });

  const measureCrews = filteredCrews.filter(
    (c) => c.crew_type === "measure_tech"
  );
  const installCrews = filteredCrews.filter(
    (c) =>
      c.crew_type === "install_in_house" ||
      c.crew_type === "install_sub" ||
      c.crew_type === "jip" ||
      c.crew_type === "svc"
  );

  return (
    <div className="flex-1 overflow-auto">
      {(filterType === "all" || filterType === "tech_measure") &&
        measureCrews.length > 0 && (
          <CrewSection
            title="Measure Techs"
            crews={measureCrews}
            timeBlocks={MEASURE_TIME_BLOCKS}
            date={date}
            appointments={appointments}
            onCardClick={setSelectedAppt}
            onCellClick={(crewId, block) =>
              setScheduleTarget({ crewId, block })
            }
          />
        )}

      {(filterType === "all" || filterType !== "tech_measure") &&
        installCrews.length > 0 && (
          <CrewSection
            title="Install / Service / JIP"
            crews={installCrews}
            timeBlocks={INSTALL_TIME_BLOCKS}
            date={date}
            appointments={appointments}
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
  timeBlocks,
  date,
  appointments,
  onCardClick,
  onCellClick,
}: {
  title: string;
  crews: Crew[];
  timeBlocks: TimeBlock[];
  date: Date;
  appointments: Appointment[];
  onCardClick: (a: Appointment) => void;
  onCellClick: (crewId: string, block: TimeBlock) => void;
}) {
  return (
    <div className="mb-6">
      <h3 className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider bg-surface sticky top-0 z-10">
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[600px]">
          <thead>
            <tr>
              <th className="w-24 p-2 text-xs text-muted font-medium text-left border-b border-border sticky left-0 bg-background z-10">
                Time
              </th>
              {crews.map((crew) => (
                <th
                  key={crew.id}
                  className="p-2 text-xs font-medium text-center border-b border-border min-w-[140px]"
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: crew.color }}
                    />
                    <span className="truncate">{crew.name}</span>
                  </div>
                  {crew.notes && (
                    <div className="text-[10px] text-muted font-normal mt-0.5">
                      {crew.notes}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeBlocks.map((block) => (
              <tr key={block}>
                <td className="p-2 text-xs text-muted border-b border-border whitespace-nowrap sticky left-0 bg-background z-10">
                  {timeBlockLabel(block)}
                </td>
                {crews.map((crew) => {
                  const cellAppts = getAppointmentsForCrewAndDay(
                    appointments,
                    crew.id,
                    date
                  ).filter((a) => a.time_block === block);

                  return (
                    <td
                      key={crew.id}
                      className="p-1 border-b border-border border-l border-l-border/50 align-top min-h-[60px]"
                    >
                      {cellAppts.length > 0 ? (
                        <div className="space-y-1">
                          {cellAppts.map((a) => (
                            <AppointmentCard
                              key={a.id}
                              appointment={a}
                              crew={crew}
                              compact={timeBlocks.length > 1}
                              onClick={() => onCardClick(a)}
                            />
                          ))}
                        </div>
                      ) : (
                        <button
                          onClick={() => onCellClick(crew.id, block)}
                          className="w-full h-12 rounded-lg border border-dashed border-border/50 hover:border-primary hover:bg-primary-light/30 transition-colors flex items-center justify-center group"
                        >
                          <Plus
                            size={14}
                            className="text-muted/30 group-hover:text-primary"
                          />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
