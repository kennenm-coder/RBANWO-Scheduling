"use client";

import { useState, useRef, useEffect } from "react";
import { ViewMode } from "@/lib/types";
import { formatDateFull, formatWeekRange } from "@/lib/calendar-utils";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  LayoutGrid,
  Search,
  X,
  Sun,
  Moon,
  Monitor,
  AlertTriangle,
} from "lucide-react";
import { useData } from "./DataProvider";
import ProfileMenu from "./ProfileMenu";
import { parseISO } from "date-fns";
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
  flagCount?: number;
  onFlagsClick?: () => void;
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
  flagCount = 0,
  onFlagsClick,
}: Props) {
  const { connected } = useData();
  const [searchOpen, setSearchOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const searchRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

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

      {/* Search */}
      {searchOpen && (
        <div className="flex items-center gap-1 bg-surface border border-border rounded-full px-2 py-1">
          <Search size={14} className="text-muted shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder="Search jobs..."
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
        <div
          className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-danger"}`}
          title={connected ? "Connected" : "Disconnected"}
          aria-label={connected ? "Connected to server" : "Disconnected from server"}
        />
        <button
          onClick={() => onViewChange("day")}
          className={`p-1.5 rounded-full ${viewMode === "day" ? "bg-primary-light text-primary" : "hover:bg-surface"}`}
          aria-label="Day view"
          title="Day view"
        >
          <CalendarDays size={16} />
        </button>
        <button
          onClick={() => onViewChange("week")}
          className={`p-1.5 rounded-full ${viewMode === "week" ? "bg-primary-light text-primary" : "hover:bg-surface"}`}
          aria-label="Week view"
          title="Week view"
        >
          <LayoutGrid size={16} />
        </button>
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
