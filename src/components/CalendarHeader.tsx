"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { ViewMode, Appointment } from "@/lib/types";
import { formatDateFull, formatWeekRange, formatDateStr, typeLabel } from "@/lib/calendar-utils";
import { searchAppointments } from "@/lib/search-utils";
import {
  ChevronLeft,
  ChevronRight,
  CalendarSearch,
  Search,
  X,
  Sun,
  Moon,
  Monitor,
  AlertTriangle,
  Eye,
  EyeOff,
  MapPin,
  Calendar,
} from "lucide-react";
import { useData } from "./DataProvider";
import ProfileMenu from "./ProfileMenu";
import { parseISO, format } from "date-fns";
import { Theme, getSavedTheme, applyTheme } from "@/lib/theme";

interface Props {
  currentDate: Date;
  viewMode: ViewMode;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (mode: ViewMode) => void;
  onDateChange?: (date: Date) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  onJumpToAppointment?: (date: Date) => void;
  flagCount?: number;
  onFlagsClick?: () => void;
  showRForce?: boolean;
  onToggleRForce?: () => void;
}

export default function CalendarHeader({
  currentDate,
  viewMode,
  onPrev,
  onNext,
  onToday,
  onViewChange,
  onDateChange,
  searchQuery = "",
  onSearchChange,
  onJumpToAppointment,
  flagCount = 0,
  onFlagsClick,
  showRForce = false,
  onToggleRForce,
}: Props) {
  const { connected, appointments, crews } = useData();
  const [searchOpen, setSearchOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const nativeDateRef = useRef<HTMLInputElement>(null);

  // Global search: search ALL loaded appointments, not just the current view
  const crewMap = useMemo(() => new Map(crews.map((c) => [c.id, c])), [crews]);
  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    const scheduled = appointments.filter((a) => a.status !== "cancelled" && a.status !== "unscheduled" && a.scheduled_date);
    const matches = searchAppointments(scheduled, crews, searchQuery);
    // Sort by date descending (most recent first), limit to 8
    return matches
      .sort((a, b) => (b.scheduled_date || "").localeCompare(a.scheduled_date || ""))
      .slice(0, 8);
  }, [searchQuery, appointments, crews]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!searchOpen || !searchFocused) return;
    function handleClick(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [searchOpen, searchFocused]);

  useEffect(() => {
    const saved = getSavedTheme();
    setTheme(saved);
    applyTheme(saved);
  }, []);

  function cycleTheme() {
    const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    applyTheme(next);
  }

  function handleSearchToggle() {
    if (searchOpen) {
      onSearchChange?.("");
      setSearchOpen(false);
    } else {
      setSearchOpen(true);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }

  function handleDatePick(dateStr: string) {
    if (dateStr && onDateChange) {
      onDateChange(parseISO(dateStr));
    }
    setDatePickerOpen(false);
  }

  return (
    <header className="bg-background border-b border-border px-3 py-2 flex items-center gap-2 sticky top-0 z-30">
      <div className="flex items-center gap-1 shrink-0">
        {/* Jump-to-date: opens native date picker */}
        <div className="relative">
          <button
            onClick={() => nativeDateRef.current?.showPicker()}
            className="p-1.5 rounded-full hover:bg-surface active:bg-primary-light"
            aria-label="Jump to date"
            title="Jump to a date"
          >
            <CalendarSearch size={18} />
          </button>
          <input
            ref={nativeDateRef}
            type="date"
            value={format(currentDate, "yyyy-MM-dd")}
            onChange={(e) => {
              if (e.target.value && onDateChange) {
                onDateChange(parseISO(e.target.value));
              }
            }}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            tabIndex={-1}
          />
        </div>
        <button
          onClick={onPrev}
          className="p-1.5 rounded-full hover:bg-surface active:bg-primary-light"
          aria-label="Previous"
          title={viewMode === "day" ? "Previous day" : "Previous week"}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={onToday}
          className="px-2.5 py-1 text-xs font-medium rounded-full border border-border hover:bg-surface"
          aria-label="Go to today"
        >
          Today
        </button>
        <button
          onClick={onNext}
          className="p-1.5 rounded-full hover:bg-surface active:bg-primary-light"
          aria-label="Next"
          title={viewMode === "day" ? "Next day" : "Next week"}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Date title — click to open date picker */}
      <div className="flex-1 min-w-0 text-center relative">
        <button
          onClick={() => setDatePickerOpen(!datePickerOpen)}
          className="text-sm font-semibold text-foreground truncate hover:text-primary transition-colors"
          aria-label="Pick a date"
          title="Click to jump to a date"
        >
          {viewMode === "day"
            ? formatDateFull(currentDate)
            : formatWeekRange(currentDate)}
        </button>
        {datePickerOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setDatePickerOpen(false)}
            />
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-background border border-border rounded-lg shadow-lg p-3">
              <input
                ref={dateRef}
                type="date"
                autoFocus
                className="border border-border rounded px-2 py-1 text-sm bg-background"
                onChange={(e) => handleDatePick(e.target.value)}
              />
              <div className="flex gap-1 mt-2">
                {[
                  { label: "+4 wks", weeks: 4 },
                  { label: "+8 wks", weeks: 8 },
                  { label: "+3 mo", weeks: 13 },
                ].map((jump) => (
                  <button
                    key={jump.label}
                    onClick={() => {
                      if (onDateChange) {
                        const d = new Date(currentDate);
                        d.setDate(d.getDate() + jump.weeks * 7);
                        onDateChange(d);
                      }
                      setDatePickerOpen(false);
                    }}
                    className="px-2 py-1 text-[10px] font-medium rounded border border-border hover:bg-surface"
                  >
                    {jump.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Search with global results dropdown */}
      {searchOpen && (
        <div ref={searchContainerRef} className="relative">
          <div className="flex items-center gap-1 bg-surface border border-border rounded-full px-2 py-1">
            <Search size={14} className="text-muted shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              placeholder="Search all scheduled jobs..."
              className="bg-transparent text-sm outline-none w-32 sm:w-48"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange?.("")}
                className="p-0.5 rounded-full hover:bg-border"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Search results dropdown */}
          {searchFocused && searchQuery && searchQuery.length >= 2 && (
            <div className="absolute top-full right-0 mt-1 w-72 sm:w-80 bg-background border border-border rounded-lg shadow-xl z-50 max-h-[360px] overflow-y-auto">
              {searchResults.length === 0 ? (
                <div className="p-3 text-center text-muted text-xs">
                  No scheduled jobs match &ldquo;{searchQuery}&rdquo;
                </div>
              ) : (
                <>
                  <div className="px-3 py-1.5 text-[10px] text-muted font-medium border-b border-border bg-surface rounded-t-lg">
                    {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} across all weeks
                  </div>
                  {searchResults.map((appt) => (
                    <SearchResultRow
                      key={appt.id}
                      appointment={appt}
                      crewName={appt.crew_id ? crewMap.get(appt.crew_id)?.name : undefined}
                      onClick={() => {
                        if (appt.scheduled_date && onJumpToAppointment) {
                          onJumpToAppointment(parseISO(appt.scheduled_date));
                        }
                        setSearchFocused(false);
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleSearchToggle}
          className={`p-1.5 rounded-full ${searchOpen ? "bg-primary-light text-primary" : "hover:bg-surface"}`}
          aria-label={searchOpen ? "Close search" : "Search scheduled jobs"}
          title="Search scheduled jobs"
        >
          <Search size={16} />
        </button>
        {onFlagsClick && (
          <button
            onClick={onFlagsClick}
            className="relative p-1.5 rounded-full hover:bg-surface"
            aria-label={`${flagCount} issues`}
            title={`${flagCount} scheduling issues`}
          >
            <AlertTriangle size={16} className={flagCount > 0 ? "text-warning" : "text-muted"} />
            {flagCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                {flagCount > 99 ? "99+" : flagCount}
              </span>
            )}
          </button>
        )}
        {onToggleRForce && (
          <button
            onClick={onToggleRForce}
            className={`flex items-center gap-0.5 px-2 py-1 text-[11px] font-semibold rounded-full border transition-colors ${
              showRForce
                ? "bg-primary text-white border-primary"
                : "border-border hover:bg-surface text-muted"
            }`}
            aria-label={showRForce ? "Hide rForce overlay" : "Show rForce overlay"}
            title={showRForce ? "Hide rForce overlay" : "Show rForce overlay"}
          >
            {showRForce ? <Eye size={12} /> : <EyeOff size={12} />}
            <span>rF</span>
          </button>
        )}
        <div
          className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-danger"}`}
          title={connected ? "Connected" : "Disconnected"}
          aria-label={connected ? "Connected to server" : "Disconnected from server"}
        />
        <div className="flex rounded-full border border-border overflow-hidden">
          <button
            onClick={() => onViewChange("day")}
            className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${viewMode === "day" ? "bg-primary text-white" : "hover:bg-surface text-muted"}`}
            aria-label="Day view"
            title="Day view (D)"
          >
            Day
          </button>
          <button
            onClick={() => onViewChange("week")}
            className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${viewMode === "week" ? "bg-primary text-white" : "hover:bg-surface text-muted"}`}
            aria-label="Week view"
            title="Week view (W)"
          >
            Week
          </button>
          <button
            onClick={() => onViewChange("block")}
            className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${viewMode === "block" ? "bg-primary text-white" : "hover:bg-surface text-muted"}`}
            aria-label="Block view"
            title="Block view (B)"
          >
            Block
          </button>
        </div>
        <div className="w-px h-4 bg-border mx-0.5" />
        <button
          onClick={cycleTheme}
          className="p-1.5 rounded-full hover:bg-surface"
          aria-label={`Theme: ${theme}`}
          title={`Theme: ${theme} (click to cycle)`}
        >
          {theme === "light" ? <Sun size={16} /> : theme === "dark" ? <Moon size={16} /> : <Monitor size={16} />}
        </button>
        <ProfileMenu />
      </div>
    </header>
  );
}

// ── Search Result Row ──

function SearchResultRow({
  appointment,
  crewName,
  onClick,
}: {
  appointment: Appointment;
  crewName?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 hover:bg-surface transition-colors border-b border-border/50 last:border-b-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-xs truncate">
          {appointment.customer_name}
        </span>
        <span className="text-[10px] text-muted shrink-0 font-medium">
          {typeLabel(appointment.appointment_type)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted mt-0.5">
        {appointment.scheduled_date && (
          <span className="flex items-center gap-0.5">
            <Calendar size={9} />
            {formatDateStr(appointment.scheduled_date)}
          </span>
        )}
        {crewName && (
          <span className="truncate">{crewName}</span>
        )}
        {appointment.address && (
          <span className="flex items-center gap-0.5 truncate">
            <MapPin size={9} className="shrink-0" />
            {appointment.address.split(",")[0]}
          </span>
        )}
      </div>
    </button>
  );
}
