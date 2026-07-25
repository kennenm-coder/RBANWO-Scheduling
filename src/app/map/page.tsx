"use client";

import { useState, useCallback } from "react";
import { addDays, subDays, format } from "date-fns";
import { useSwipe } from "@/hooks/useSwipe";
import { useData } from "@/components/DataProvider";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 size={32} className="animate-spin text-primary" />
    </div>
  ),
});

export default function MapPage() {
  const { loading } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());

  const navigate = useCallback((direction: "prev" | "next") => {
    setCurrentDate((prev) =>
      direction === "next" ? addDays(prev, 1) : subDays(prev, 1)
    );
  }, []);

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
    <div className="flex flex-col h-full" ref={swipeRef}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
        <button
          onClick={() => navigate("prev")}
          className="p-1.5 rounded-full hover:bg-surface"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">
            {format(currentDate, "EEEE, MMMM d, yyyy")}
          </h2>
          <button
            onClick={() => setCurrentDate(new Date())}
            className="px-2 py-0.5 text-xs bg-surface rounded-full hover:bg-border"
          >
            Today
          </button>
        </div>
        <button
          onClick={() => navigate("next")}
          className="p-1.5 rounded-full hover:bg-surface"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <MapView date={currentDate} />
    </div>
  );
}
