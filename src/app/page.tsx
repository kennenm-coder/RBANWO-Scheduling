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
import { ViewMode, AppointmentType } from "@/lib/types";
import { Loader2 } from "lucide-react";

export default function CalendarPage() {
  const { loading } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [filterType, setFilterType] = useState<AppointmentType | "all">("all");
  const [slideDir, setSlideDir] = useState<"next" | "prev" | null>(null);

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
    <div className="flex flex-col h-full">
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
  );
}
