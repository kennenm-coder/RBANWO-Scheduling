"use client";

import { ViewMode } from "@/lib/types";
import { formatDateFull, formatWeekRange } from "@/lib/calendar-utils";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  LayoutGrid,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useData } from "./DataProvider";

interface Props {
  currentDate: Date;
  viewMode: ViewMode;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (mode: ViewMode) => void;
}

export default function CalendarHeader({
  currentDate,
  viewMode,
  onPrev,
  onNext,
  onToday,
  onViewChange,
}: Props) {
  const { connected } = useData();

  return (
    <header className="bg-background border-b border-border px-4 py-3 flex items-center gap-2 sticky top-0 z-30">
      <div className="flex items-center gap-1 mr-auto">
        <button
          onClick={onPrev}
          className="p-2 rounded-full hover:bg-surface active:bg-primary-light"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={onToday}
          className="px-3 py-1 text-sm font-medium rounded-full border border-border hover:bg-surface"
        >
          Today
        </button>
        <button
          onClick={onNext}
          className="p-2 rounded-full hover:bg-surface active:bg-primary-light"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <h1 className="text-sm font-semibold text-foreground truncate flex-1 text-center">
        {viewMode === "day"
          ? formatDateFull(currentDate)
          : formatWeekRange(currentDate)}
      </h1>

      <div className="flex items-center gap-1 ml-auto">
        <div
          className={`w-2 h-2 rounded-full mr-1 ${connected ? "bg-success" : "bg-danger"}`}
          title={connected ? "Connected" : "Disconnected"}
        />
        <button
          onClick={() => onViewChange("day")}
          className={`p-2 rounded-full ${viewMode === "day" ? "bg-primary-light text-primary" : "hover:bg-surface"}`}
        >
          <CalendarDays size={18} />
        </button>
        <button
          onClick={() => onViewChange("week")}
          className={`p-2 rounded-full ${viewMode === "week" ? "bg-primary-light text-primary" : "hover:bg-surface"}`}
        >
          <LayoutGrid size={18} />
        </button>
      </div>
    </header>
  );
}
