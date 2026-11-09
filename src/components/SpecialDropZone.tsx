"use client";

import { useRef } from "react";
import { parseISO } from "date-fns";
import { useSchedulerDrag } from "@/lib/drag-context";
import { useData } from "./DataProvider";
import { useToast } from "./Toast";
import { getAppointmentsForCrewAndDay } from "@/lib/calendar-utils";
import { labelForBlockingKind } from "@/lib/availability";

/**
 * Wraps the calendar and turns a Special Ops / Office Day drag into a one-day
 * block on whichever crew-day cell it lands on.
 *
 * Every calendar view tags its crew-day cells with `data-crew-day="crewId|date"`
 * (the same key presence hover uses), so this one capture-phase handler serves
 * the day, week and block views without each cell learning about special drags.
 * It only acts while a special tile is being dragged; job and appointment drags
 * pass straight through to the cells' own handlers.
 */
const OVER_CLASS = "special-drop-over";

export default function SpecialDropZone({ children }: { children: React.ReactNode }) {
  const { draggedSpecial, clearDrag } = useSchedulerDrag();
  const { assignSpecialDay, appointments, crews } = useData();
  const { showToast } = useToast();
  const hovered = useRef<HTMLElement | null>(null);

  function setHover(el: HTMLElement | null) {
    if (hovered.current === el) return;
    hovered.current?.classList.remove(OVER_CLASS);
    el?.classList.add(OVER_CLASS);
    hovered.current = el;
  }

  function cellFor(e: React.DragEvent): HTMLElement | null {
    return (e.target as HTMLElement | null)?.closest?.("[data-crew-day]") ?? null;
  }

  return (
    <div
      className="flex-1 flex flex-col min-w-0"
      onDragOverCapture={(e) => {
        if (!draggedSpecial) return;
        const cell = cellFor(e);
        if (!cell) return setHover(null);
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setHover(cell);
      }}
      onDragLeaveCapture={(e) => {
        if (!draggedSpecial) return;
        // Leaving the zone entirely, not just crossing cell borders.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
      }}
      onDropCapture={(e) => {
        if (!draggedSpecial) return;
        const cell = cellFor(e);
        setHover(null);
        if (!cell) return;
        e.preventDefault();
        e.stopPropagation();
        const kind = draggedSpecial;
        clearDrag();
        const [crewId, date] = (cell.getAttribute("data-crew-day") || "").split("|");
        if (!crewId || !date) return;
        const crew = crews.find((c) => c.id === crewId);
        const label = labelForBlockingKind(kind);
        const booked = getAppointmentsForCrewAndDay(appointments, crewId, parseISO(date)).filter(
          (a) => a.status !== "cancelled" && a.status !== "unscheduled"
        ).length;
        assignSpecialDay(crewId, date, kind)
          .then(() =>
            booked > 0
              ? showToast(
                  `${crew?.name ?? "Crew"} marked ${label}, but already has ${booked} job${booked === 1 ? "" : "s"} that day`,
                  "warning"
                )
              : showToast(`${crew?.name ?? "Crew"} marked ${label} on ${date}`)
          )
          .catch((err) =>
            showToast(err instanceof Error ? err.message : "Could not save the assignment", "error")
          );
      }}
      onDragEnd={() => setHover(null)}
    >
      {children}
    </div>
  );
}
