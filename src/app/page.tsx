"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { addDays, subDays, startOfWeek, addWeeks, subWeeks, parseISO, format, isValid } from "date-fns";
import { isPlausibleScheduleDate } from "@/lib/date-guard";
import { useSearchParams } from "next/navigation";
import { useSwipe } from "@/hooks/useSwipe";
import { useData } from "@/components/DataProvider";
import CalendarHeader from "@/components/CalendarHeader";
import WeekSummary from "@/components/WeekSummary";
import FilterPanel from "@/components/FilterPanel";
import CrewLaneDayView from "@/components/CrewLaneDayView";
import CrewLaneWeekView from "@/components/CrewLaneWeekView";
import CrewBlockView from "@/components/CrewBlockView";
import UnscheduledQueue from "@/components/UnscheduledQueue";
import AppointmentSheet from "@/components/AppointmentSheet";
import { fetchAppointmentById } from "@/lib/store";
import { ViewMode, AppointmentType, Appointment } from "@/lib/types";
import { Loader2, PanelLeftOpen, PanelLeftClose, CalendarOff, ExternalLink } from "lucide-react";
import { SchedulerDragProvider } from "@/lib/drag-context";
import { useAuth } from "@/components/AuthProvider";
import {
  calendarStateKey,
  readCalendarViewState,
  restoredDate,
  restoredView,
  writeCalendarViewState,
} from "@/lib/calendar-view-state";
import PresenceProvider from "@/components/PresenceProvider";

const DUCK_FORCE_PTO_URL = "https://betterthengooglecal-5taw.vercel.app/time-off?from=scheduler";

const RFORCE_STORAGE_KEY = "rbanwo-sched-show-rforce";

export default function CalendarPage() {
  const { loading, ensureDateRange, appointments, crews, rforceOrders, timeOffRequests, activeLinks, availabilityRules, availabilityExceptions } = useData();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  // Per-account, per-device slot holding "where I left the calendar". Read once
  // into the initial state so the first paint is already on the saved day/view
  // rather than flashing today-in-week-view and then jumping.
  const stateKey = calendarStateKey(user?.id);
  const [savedState] = useState(() => readCalendarViewState(stateKey));
  const [currentDate, setCurrentDate] = useState(() => restoredDate(savedState));
  const [viewMode, setViewMode] = useState<ViewMode>(() => restoredView(savedState));
  const [filterType, setFilterType] = useState<AppointmentType | "all">("all");
  const [slideDir, setSlideDir] = useState<"next" | "prev" | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showRForce, setShowRForce] = useState(false);
  // Crew to scroll to + highlight when arriving from an Issues-page click.
  const [focusCrewId, setFocusCrewId] = useState<string | null>(null);
  // Tile opened by `?appt=<id>` deep link. Loaded by id rather than read from
  // `appointments` because the link exists precisely for tiles that aren't in
  // that list — a cancelled job the Issues tab is pointing at.
  const [deepLinkAppt, setDeepLinkAppt] = useState<Appointment | null>(null);

  const initializedRef = useRef(false);

  // Read date/view from query params (reactive — updates on router.push)
  useEffect(() => {
    const dateParam = searchParams.get("date");
    const viewParam = searchParams.get("view") as ViewMode | null;
    const crewParam = searchParams.get("crew");
    if (dateParam) {
      // parseISO never throws — it returns Invalid Date, which then crashed the
      // header's format(). Only jump when the date is real and plausible.
      const parsed = parseISO(dateParam);
      if (isValid(parsed) && isPlausibleScheduleDate(dateParam)) setCurrentDate(parsed);
    }
    if (viewParam === "day" || viewParam === "week" || viewParam === "block") {
      setViewMode(viewParam);
    }
    if (crewParam) setFocusCrewId(crewParam);
    const apptParam = searchParams.get("appt");
    if (apptParam) {
      // Not found (deleted since the Issues list was built) just leaves the
      // sheet closed on the right day — no error state worth showing.
      fetchAppointmentById(apptParam).then((a) => {
        if (a) setDeepLinkAppt(a);
      });
    }
    // Clean query params from the URL after reading
    if (dateParam || viewParam || crewParam || apptParam) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [searchParams]);

  // One-time init: read hash (bookmarks) and localStorage
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const dateParam = params.get("date");
    const viewParam = params.get("view") as ViewMode | null;
    if (dateParam) {
      // parseISO never throws — it returns Invalid Date, which then crashed the
      // header's format(). Only jump when the date is real and plausible.
      const parsed = parseISO(dateParam);
      if (isValid(parsed) && isPlausibleScheduleDate(dateParam)) setCurrentDate(parsed);
    }
    if (viewParam === "day" || viewParam === "week" || viewParam === "block") {
      setViewMode(viewParam);
    }
    const savedRForce = localStorage.getItem(RFORCE_STORAGE_KEY);
    if (savedRForce === "true") setShowRForce(true);
    initializedRef.current = true;
  }, []);

  // A different account signed in on this device: adopt that account's saved
  // position instead of leaving the previous user's day on screen.
  const appliedKeyRef = useRef(stateKey);
  useEffect(() => {
    if (appliedKeyRef.current === stateKey) return;
    appliedKeyRef.current = stateKey;
    const saved = readCalendarViewState(stateKey);
    setViewMode(restoredView(saved));
    setCurrentDate(restoredDate(saved));
  }, [stateKey]);

  useEffect(() => {
    if (!initializedRef.current) return;
    const day = format(currentDate, "yyyy-MM-dd");
    window.history.replaceState(null, "", `#date=${day}&view=${viewMode}`);
    // Survives leaving the tab: BottomNav routes away and unmounts this page,
    // so the hash alone can't bring the position back.
    writeCalendarViewState(stateKey, { view: viewMode, date: day });
  }, [currentDate, viewMode, stateKey]);

  useEffect(() => {
    ensureDateRange(currentDate);
  }, [currentDate, ensureDateRange]);

  const handleViewChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
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
          : direction === "next"  // week and block both navigate by week
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
        case "b":
          if (!e.metaKey && !e.ctrlKey) handleViewChange("block");
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
    <SchedulerDragProvider>
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

      {/* Queue panel — unmounted when closed so it doesn't render (and diff)
          hundreds of hidden cards. Filters/search persist to localStorage via
          useQueueFilters, so state is restored on reopen. */}
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
      <PresenceProvider viewMode={viewMode} currentDate={currentDate}>
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
          onJumpToAppointment={(date) => {
            setCurrentDate(date);
            // Keep current view but ensure the date is visible
          }}
          showRForce={showRForce}
          onToggleRForce={handleToggleRForce}
        />

        {/* Only show WeekSummary in day view — week and block views already
            show the days of the week in their own column headers. */}
        {viewMode === "day" && (
          <WeekSummary
            currentDate={currentDate}
            onDayClick={(date) => {
              setCurrentDate(date);
              handleViewChange("day");
            }}
          />
        )}

        <FilterPanel value={filterType} onChange={setFilterType} />

        <div
          ref={swipeRef}
          className={`flex-1 flex flex-col min-h-0 overflow-hidden ${
            slideDir === "next"
              ? "slide-next"
              : slideDir === "prev"
                ? "slide-prev"
                : ""
          }`}
        >
          {viewMode === "day" ? (
            <CrewLaneDayView
              date={currentDate}
              filterType={filterType}
              showRForce={showRForce}
              focusCrewId={focusCrewId}
              onFocusHandled={() => setFocusCrewId(null)}
            />
          ) : viewMode === "block" ? (
            <CrewBlockView
              currentDate={currentDate}
              filterType={filterType}
              onDayClick={(date) => {
                setCurrentDate(date);
                handleViewChange("day");
              }}
            />
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

        {/* Deep-linked tile (?appt=…). Rendered here rather than inside a view
            because a cancelled tile has no lane to be clicked from. Edit and
            reschedule just close it — the sheet's cancelled branch offers
            Restore and Delete, which is all this link is for. */}
        {deepLinkAppt && (
          <AppointmentSheet
            appointment={deepLinkAppt}
            onClose={() => setDeepLinkAppt(null)}
            onEdit={() => setDeepLinkAppt(null)}
          />
        )}
      </div>
      </PresenceProvider>
    </div>
    </SchedulerDragProvider>
  );
}
