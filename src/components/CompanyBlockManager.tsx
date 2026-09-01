"use client";

import { useState } from "react";
import { useData } from "./DataProvider";
import { CalendarBlock, CalendarBlockKind } from "@/lib/types";
import { formatDateStr } from "@/lib/calendar-utils";
import { format } from "date-fns";
import { CalendarOff, Plus, Trash2, X, Building2, PartyPopper } from "lucide-react";

const KIND_OPTIONS: { value: CalendarBlockKind; label: string }[] = [
  { value: "holiday", label: "Holiday / Closure" },
  { value: "company_meeting", label: "All-Office Meeting" },
];

function kindLabel(kind: CalendarBlockKind): string {
  return kind === "holiday" ? "Holiday" : "Office Meeting";
}

/** Compact time like "10:00" → "10:00a". Falls back to the raw string. */
function shortTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return t;
  const ampm = h < 12 ? "a" : "p";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ampm}` : `${h12}${ampm}`;
}

function describeWindow(block: CalendarBlock): string {
  if (!block.start_time && !block.end_time) return "All day";
  const s = block.start_time ? shortTime(block.start_time) : "";
  const e = block.end_time ? shortTime(block.end_time) : "";
  if (s && e) return `${s}–${e}`;
  return s || e || "All day";
}

export default function CompanyBlockManager() {
  const { calendarBlocks, saveCalendarBlock, removeCalendarBlock } = useData();

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<CalendarBlockKind>("holiday");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sorted = [...calendarBlocks].sort((a, b) =>
    a.start_date.localeCompare(b.start_date)
  );
  const today = format(new Date(), "yyyy-MM-dd");
  const upcoming = sorted.filter((b) => (b.end_date || b.start_date) >= today);

  function resetForm() {
    setKind("holiday");
    setStartDate(format(new Date(), "yyyy-MM-dd"));
    setEndDate("");
    setAllDay(true);
    setStartTime("10:00");
    setEndTime("11:00");
    setReason("");
    setAdding(false);
  }

  async function handleSave() {
    if (!startDate) return;
    if (!allDay && startTime >= endTime) {
      alert("End time must be after start time.");
      return;
    }
    setSaving(true);
    try {
      await saveCalendarBlock({
        kind,
        start_date: startDate,
        end_date: endDate && endDate !== startDate ? endDate : null,
        start_time: allDay ? null : startTime,
        end_time: allDay ? null : endTime,
        reason: reason.trim() || null,
        is_active: true,
      });
      resetForm();
    } catch {
      alert("Failed to save company block.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await removeCalendarBlock(id);
    } catch {
      alert("Failed to remove company block.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mb-6 border border-border rounded-xl p-4 bg-surface/50">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <CalendarOff size={16} className="text-primary" />
          <h3 className="text-sm font-semibold">Company-Wide Blocks</h3>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:opacity-90"
          >
            <Plus size={14} />
            Add Block
          </button>
        )}
      </div>
      <p className="text-xs text-muted mb-3">
        Blocks a day for <span className="font-medium">every</span> crew at once —
        holidays, office closures, or all-office meetings. Existing appointments
        aren&apos;t moved; they&apos;re flagged in the Issue Center.
      </p>

      {adding && (
        <div className="mb-4 border border-primary/40 rounded-lg p-3 bg-primary/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-primary">New block</span>
            <button
              onClick={resetForm}
              className="p-1 rounded-full hover:bg-surface text-muted"
              title="Cancel"
            >
              <X size={14} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Type</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as CalendarBlockKind)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Reason (optional)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={kind === "holiday" ? "e.g. Thanksgiving" : "e.g. All-hands"}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">End date (optional)</label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="rounded border-border"
            />
            All day
          </label>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">From</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">To</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !startDate}
            className="w-full py-2 bg-primary text-white rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            {saving ? "Saving..." : "Add Block"}
          </button>
        </div>
      )}

      {upcoming.length === 0 ? (
        <div className="text-center text-muted py-4 text-xs">
          No upcoming company-wide blocks.
        </div>
      ) : (
        <div className="space-y-2">
          {upcoming.map((block) => {
            const Icon = block.kind === "holiday" ? PartyPopper : Building2;
            const range =
              block.end_date && block.end_date !== block.start_date
                ? `${formatDateStr(block.start_date)} – ${formatDateStr(block.end_date)}`
                : formatDateStr(block.start_date);
            return (
              <div
                key={block.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-background"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon size={16} className="text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {block.reason || kindLabel(block.kind)}
                    </div>
                    <div className="text-xs text-muted">
                      {range} &middot; {describeWindow(block)}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(block.id)}
                  disabled={deletingId === block.id}
                  className="p-1.5 rounded-full hover:bg-danger/10 text-danger disabled:opacity-50 shrink-0"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
