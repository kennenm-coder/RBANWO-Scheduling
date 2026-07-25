"use client";

import { useState, useCallback } from "react";
import { addDays, subDays, startOfWeek, addWeeks, subWeeks } from "date-fns";
import { useSwipe } from "@/hooks/useSwipe";
import { useData } from "@/components/DataProvider";
import CalendarHeader from "@/components/CalendarHeader";
import WeekSummary from "@/components/WeekSummary";
import FilterPanel from "@/components/FilterPanel";
import CrewLaneDayView from "@/components/CrewLaneDayView";
import CrewLaneWeekView from "@/components/CrewLaneWeekView";
import UnscheduledQueue from "@/components/UnscheduledQueue";
import { ViewMode, AppointmentType } from "@/lib/types";
import { Loader2, PanelLeftOpen, PanelLeftClose } from "lucide-react";

export default function CalendarPage() {
  const { loading } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [filterType, setFilterType] = useState<AppointmentType | "all">("all");
  const [slideDir, setSlideDir] = useState<"next" | "prev" | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);

  const navigate = useCallback(
    (direction: "prev" | "next") => {
      setSlideDir(direction);
      setCurrentDate((prev) =>
        viewMode === "day"
          ? direction === "next"
            ? addDays(prev, 1)
            : subDays(prev, 1)
          : direction === "next"
            ? addWeeks(prev, 1)
            : subWeeks(prev, 1)
      );
      setTimeout(() => setSlideDir(null), 300);
    },
    [viewMode]
  );

  const swipeRef = useSwipe({
    onSwipeLeft: () => navigate("next"),
    onSwipeRight: () => navigate("prev"),
  });

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Queue toggle button */}
      <button
        onClick={() => setQueueOpen(!queueOpen)}
        className="shrink-0 w-8 flex flex-col items-center justify-center bg-surface border-r border-border hover:bg-border transition-colors z-20"
        title={queueOpen ? "Close queue" : "Open queue"}
      >
        {queueOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        <span className="text-[9px] text-muted mt-1 [writing-mode:vertical-lr] tracking-wider uppercase">
          Queue
        </span>
      </button>

      {/* Queue panel */}
      <div
        className={`shrink-0 border-r border-border bg-background overflow-hidden transition-all duration-300 ${
          queueOpen ? "w-[380px]" : "w-0"
        }`}
      >
        {queueOpen && (
          <div className="w-[380px] h-full flex flex-col">
            <div className="px-3 py-2 border-b border-border bg-surface flex items-center justify-between">
              <h2 className="text-sm font-semibold">Unscheduled Queue</h2>
            </div>
            <UnscheduledQueue />
          </div>
        )}
      </div>

      {/* Calendar */}
      <div className="flex-1 flex flex-col min-w-0">
        <CalendarHeader
          currentDate={currentDate}
          viewMode={viewMode}
          onPrev={() => navigate("prev")}
          onNext={() => navigate("next")}
          onToday={() => setCurrentDate(new Date())}
          onViewChange={setViewMode}
        />

        <WeekSummary
          currentDate={currentDate}
          onDayClick={(date) => {
            setCurrentDate(date);
            setViewMode("day");
          }}
        />

        <FilterPanel value={filterType} onChange={setFilterType} />

        <div
          ref={swipeRef}
          className={`flex-1 overflow-auto ${
            slideDir === "next"
              ? "slide-next"
              : slideDir === "prev"
                ? "slide-prev"
                : ""
          }`}
        >
          {viewMode === "day" ? (
            <CrewLaneDayView date={currentDate} filterType={filterType} />
          ) : (
            <CrewLaneWeekView
              currentDate={currentDate}
              onDayClick={(date) => {
                setCurrentDate(date);
                setViewMode("day");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
