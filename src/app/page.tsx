"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { addDays, subDays, startOfWeek, addWeeks, subWeeks, parseISO, format } from "date-fns";
import { useSwipe } from "@/hooks/useSwipe";
import { useData } from "@/components/DataProvider";
import CalendarHeader from "@/components/CalendarHeader";
import WeekSummary from "@/components/WeekSummary";
import FilterPanel from "@/components/FilterPanel";
import CrewLaneDayView from "@/components/CrewLaneDayView";
import CrewLaneWeekView from "@/components/CrewLaneWeekView";
import UnscheduledQueue from "@/components/UnscheduledQueue";
import { ViewMode, AppointmentType } from "@/lib/types";
import IssueCenter from "@/components/IssueCenter";
import { detectFlags } from "@/lib/flags";
import { Loader2, PanelLeftOpen, PanelLeftClose, CalendarOff, ExternalLink } from "lucide-react";

const DUCK_FORCE_PTO_URL = "https://betterthengooglecal-5taw.vercel.app/time-off?from=scheduler";

const VIEW_STORAGE_KEY = "rbanwo-sched-view";
const RFORCE_STORAGE_KEY = "rbanwo-sched-show-rforce";

function getSavedView(): ViewMode {
  if (typeof window === "undefined") return "week";
  return (localStorage.getItem(VIEW_STORAGE_KEY) as ViewMode) || "week";
}

export default function CalendarPage() {
  const { loading, ensureDateRange, appointments, crews, rforceOrders, timeOffRequests, activeLinks, flagResolutions } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [filterType, setFilterType] = useState<AppointmentType | "all">("all");
  const [slideDir, setSlideDir] = useState<"next" | "prev" | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [showRForce, setShowRForce] = useState(false);

  const flagCount = useMemo(() => {
    const allFlags = detectFlags(appointments, crews, rforceOrders, timeOffRequests, activeLinks);
    const resolvedKeys = new Set(flagResolutions.map((r) => r.flag_key));
    return allFlags.filter((f) => !resolvedKeys.has(f.id)).length;
  }, [appointments, crews, rforceOrders, timeOffRequests, activeLinks, flagResolutions]);

  const initializedRef = useRef(false);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const dateParam = params.get("date");
    const viewParam = params.get("view") as ViewMode | null;
    if (dateParam) {
      try { setCurrentDate(parseISO(dateParam)); } catch {}
    }
    if (viewParam === "day" || viewParam === "week") {
      setViewMode(viewParam);
      localStorage.setItem(VIEW_STORAGE_KEY, viewParam);
    } else {
      setViewMode(getSavedView());
    }
    const savedRForce = localStorage.getItem(RFORCE_STORAGE_KEY);
    if (savedRForce === "true") setShowRForce(true);
    initializedRef.current = true;
  }, []);

  useEffect(() => {
    if (!initializedRef.current) return;
    const hash = `date=${format(currentDate, "yyyy-MM-dd")}&view=${viewMode}`;
    window.history.replaceState(null, "", `#${hash}`);
  }, [currentDate, viewMode]);

  useEffect(() => {
    ensureDateRange(currentDate);
  }, [currentDate, ensureDateRange]);

  const handleViewChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  }, []);

  const handleToggleRForce = useCallback(() => {
    setShowRForce((prev) => {
      const next = !prev;
      localStorage.setItem(RFORCE_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      switch (e.key) {
        case "ArrowLeft":
          navigate("prev");
          break;
        case "ArrowRight":
          navigate("next");
          break;
        case "t":
          if (!e.metaKey && !e.ctrlKey) setCurrentDate(new Date());
          break;
        case "d":
          if (!e.metaKey && !e.ctrlKey) handleViewChange("day");
          break;
        case "w":
          if (!e.metaKey && !e.ctrlKey) handleViewChange("week");
          break;
        case "q":
          if (!e.metaKey && !e.ctrlKey) setQueueOpen((prev) => !prev);
          break;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigate, handleViewChange]);

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
      {/* Side rail: Queue toggle + Time Off */}
      <div className="shrink-0 w-8 flex flex-col bg-surface border-r border-border z-20">
        <button
          onClick={() => setQueueOpen(!queueOpen)}
          className="flex-1 flex flex-col items-center justify-center hover:bg-border transition-colors"
          aria-label={queueOpen ? "Close queue" : "Open queue"}
          title={queueOpen ? "Close queue" : "Open queue"}
        >
          {queueOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          <span className="text-[9px] text-muted mt-1 [writing-mode:vertical-lr] tracking-wider uppercase">
            Queue
          </span>
        </button>
        <a
          href={DUCK_FORCE_PTO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="py-3 flex flex-col items-center justify-center hover:bg-border transition-colors border-t border-border"
          aria-label="Open PTO in Duck Force"
          title="Open PTO in Duck Force"
        >
          <CalendarOff size={16} />
          <span className="text-[9px] text-muted mt-1 [writing-mode:vertical-lr] tracking-wider uppercase">
            PTO
          </span>
          <ExternalLink size={8} className="text-muted mt-0.5" />
        </a>
      </div>

      {/* Queue panel */}
      <div
        className={`shrink-0 border-r border-border bg-background overflow-hidden transition-all duration-300 ${
          queueOpen ? "w-full sm:w-[380px]" : "w-0"
        }`}
      >
        {queueOpen && (
          <div className="w-full sm:w-[380px] h-full flex flex-col">
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
          onViewChange={handleViewChange}
          onDateChange={setCurrentDate}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          flagCount={flagCount}
          onFlagsClick={() => setIssuesOpen(true)}
          showRForce={showRForce}
          onToggleRForce={handleToggleRForce}
        />

        <WeekSummary
          currentDate={currentDate}
          onDayClick={(date) => {
            setCurrentDate(date);
            handleViewChange("day");
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
            <CrewLaneDayView date={currentDate} filterType={filterType} showRForce={showRForce} />
          ) : (
            <CrewLaneWeekView
              currentDate={currentDate}
              filterType={filterType}
              searchQuery={searchQuery}
              showRForce={showRForce}
              onDayClick={(date) => {
                setCurrentDate(date);
                handleViewChange("day");
              }}
            />
          )}
        </div>
      </div>
      {issuesOpen && (
        <IssueCenter
          onClose={() => setIssuesOpen(false)}
          onNavigate={(date) => {
            setCurrentDate(parseISO(date));
            handleViewChange("day");
            setIssuesOpen(false);
          }}
        />
      )}
    </div>
  );
}
