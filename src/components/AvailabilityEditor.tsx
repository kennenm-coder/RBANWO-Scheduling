"use client";

import { useState, useEffect } from "react";
import { AvailabilityRule, AvailabilityKind } from "@/lib/types";
import { DATE_INPUT_MIN, DATE_INPUT_MAX } from "@/lib/date-guard";
import {
  fetchAvailabilityRules,
  upsertAvailabilityRule,
  deleteAvailabilityRule,
} from "@/lib/store";
import { Plus, Trash2, Clock, CalendarOff, Pencil, Save, Briefcase, Sunset, Building2, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { isOneDaySpecialRule, isMonthlyRule, LAST_WEEK_OF_MONTH } from "@/lib/availability";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const WEEK_OF_MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "First" },
  { value: 2, label: "Second" },
  { value: 3, label: "Third" },
  { value: 4, label: "Fourth" },
  { value: LAST_WEEK_OF_MONTH, label: "Last" },
];

type RepeatMode = "weekly" | "monthly";

const KIND_OPTIONS: { value: AvailabilityKind; label: string }[] = [
  { value: "unavailable", label: "Day Off" },
  { value: "block", label: "Custom Hours" },
  { value: "role_assignment", label: "Department Assignment" },
  { value: "late_day", label: "Late Day" },
  { value: "office_day", label: "Office Day" },
  { value: "special_ops", label: "Special Ops" },
];

const DEPARTMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "measure", label: "Measure Tech" },
  { value: "install", label: "Install" },
  { value: "service", label: "Service" },
  { value: "jip", label: "JIP" },
];

function ruleDescription(rule: AvailabilityRule): string {
  let days = rule.weekdays.length > 0
    ? rule.weekdays.map((d) => DAY_LABELS[d]).join(", ")
    : "All days";

  let interval =
    rule.repeat_interval === 2
      ? " (every other week)"
      : rule.repeat_interval > 2
        ? ` (every ${rule.repeat_interval} weeks)`
        : "";

  // Monthly pattern: "First Fri of every other month" replaces the weekly interval.
  if (isMonthlyRule(rule)) {
    const nth = WEEK_OF_MONTH_OPTIONS.find((o) => o.value === rule.week_of_month)?.label.toLowerCase() ?? `#${rule.week_of_month}`;
    const mi = rule.month_interval ?? 1;
    const every = mi === 1 ? "every month" : mi === 2 ? "every other month" : `every ${mi} months`;
    days = `the ${nth} ${days} of ${every}`;
    interval = "";
  }

  if (rule.kind === "unavailable" || rule.kind === "pto") {
    if (rule.start_time && rule.end_time) {
      return `Unavailable ${rule.start_time}–${rule.end_time} on ${days}${interval}`;
    }
    return `Off on ${days}${interval}`;
  }

  if (rule.kind === "block" && rule.start_time && rule.end_time) {
    return `Works ${rule.start_time}–${rule.end_time} on ${days}${interval}`;
  }

  if (rule.kind === "role_assignment" && rule.department) {
    const deptLabel = DEPARTMENT_OPTIONS.find((d) => d.value === rule.department)?.label || rule.department;
    return `${deptLabel} on ${days}${interval}`;
  }

  if (rule.kind === "late_day" || rule.kind === "office_day" || rule.kind === "special_ops") {
    const name = rule.kind === "late_day" ? "Late Day" : rule.kind === "special_ops" ? "Special Ops" : "Office Day";
    if (isOneDaySpecialRule(rule)) return `${name} — ${rule.effective_start} (dragged from the queue)`;
    if (rule.start_time && rule.end_time) {
      return `${name} (blocks ${rule.start_time}–${rule.end_time}) on ${days}${interval}`;
    }
    return `${name} — all day on ${days}${interval}`;
  }

  return `${rule.kind} — ${days}${interval}`;
}

export default function AvailabilityEditor({
  crewId,
  onChanged,
}: {
  crewId: string;
  onChanged?: () => void;
}) {
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const [kind, setKind] = useState<AvailabilityKind>("unavailable");
  const [department, setDepartment] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [repeatInterval, setRepeatInterval] = useState(1);
  // Monthly pattern, e.g. "first Friday of every other month".
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("weekly");
  const [weekOfMonth, setWeekOfMonth] = useState(1);
  const [monthInterval, setMonthInterval] = useState(1);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("18:00");
  // Late Day / Office Day: when true, the whole day is blocked (no times);
  // when false, only the start–end window is blocked.
  const [allDay, setAllDay] = useState(true);
  const [effectiveStart, setEffectiveStart] = useState(
    format(new Date(), "yyyy-MM-dd")
  );
  const [effectiveEnd, setEffectiveEnd] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    loadRules();
  }, [crewId]);

  async function loadRules() {
    setLoading(true);
    const { rules: all } = await fetchAvailabilityRules();
    setRules(all.filter((r) => r.crew_id === crewId));
    setLoading(false);
  }

  function toggleDay(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  }

  function resetForm() {
    setKind("unavailable");
    setDepartment("");
    setWeekdays([]);
    setRepeatInterval(1);
    setRepeatMode("weekly");
    setWeekOfMonth(1);
    setMonthInterval(1);
    setStartTime("08:00");
    setEndTime("18:00");
    setAllDay(true);
    setEffectiveStart(format(new Date(), "yyyy-MM-dd"));
    setEffectiveEnd("");
    setReason("");
    setAdding(false);
    setEditingId(null);
  }

  function startEdit(rule: AvailabilityRule) {
    setEditingId(rule.id);
    setKind(rule.kind);
    setDepartment(rule.department || "");
    setWeekdays([...rule.weekdays]);
    setRepeatInterval(rule.repeat_interval);
    setRepeatMode(isMonthlyRule(rule) ? "monthly" : "weekly");
    setWeekOfMonth(rule.week_of_month ?? 1);
    setMonthInterval(rule.month_interval ?? 1);
    setStartTime(rule.start_time || "08:00");
    setEndTime(rule.end_time || "18:00");
    setAllDay(!rule.start_time && !rule.end_time);
    setEffectiveStart(rule.effective_start);
    setEffectiveEnd(rule.effective_end || "");
    setReason(rule.reason || "");
    setAdding(true);
  }

  // Block = always a time window. Late/Office = a window only when not "all day".
  const usesTimeWindow =
    kind === "block" || ((kind === "late_day" || kind === "office_day" || kind === "special_ops") && !allDay);

  const monthly = repeatMode === "monthly";

  async function handleSave() {
    if (weekdays.length === 0) return;
    if (kind === "role_assignment" && !department) return;
    setSaving(true);
    setError(null);

    try {
      await upsertAvailabilityRule({
        ...(editingId ? { id: editingId } : {}),
        crew_id: crewId,
        kind,
        department: kind === "role_assignment" ? department : null,
        weekdays,
        repeat_interval: monthly ? 1 : repeatInterval,
        // Only sent for monthly rules / when clearing one, so ordinary weekly
        // rules keep saving even before the monthly-pattern migration is applied.
        ...(monthly
          ? { week_of_month: weekOfMonth, month_interval: monthInterval }
          : editingId
            ? { week_of_month: null, month_interval: 1 }
            : {}),
        start_time: usesTimeWindow ? startTime : null,
        end_time: usesTimeWindow ? endTime : null,
        effective_start: effectiveStart,
        effective_end: effectiveEnd || null,
        reason: reason || null,
        is_active: true,
      });
      resetForm();
      await loadRules();
      onChanged?.();
    } catch (err) {
      console.error("Rule save failed:", err);
      setError(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteAvailabilityRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
    onChanged?.();
  }

  return (
    <div>
      <label className="block text-xs text-muted mb-1.5">
        Availability / Schedule
        <span className="font-normal text-muted/60 ml-1">
          (custom operating hours)
        </span>
      </label>

      {loading ? (
        <div className="text-xs text-muted py-2">Loading...</div>
      ) : rules.length === 0 && !adding ? (
        <div className="text-xs text-muted/60 py-1">
          No custom schedule — uses default hours (8am–6pm, Mon–Fri)
        </div>
      ) : (
        <div className="space-y-1.5 mb-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-2 px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs"
            >
              {rule.kind === "role_assignment" ? (
                <Briefcase size={12} className="text-purple-500 shrink-0" />
              ) : rule.kind === "block" ? (
                <Clock size={12} className="text-blue-500 shrink-0" />
              ) : rule.kind === "late_day" ? (
                <Sunset size={12} className="text-amber-500 shrink-0" />
              ) : rule.kind === "office_day" ? (
                <Building2 size={12} className="text-teal-500 shrink-0" />
              ) : rule.kind === "special_ops" ? (
                <ShieldAlert size={12} className="text-orange-500 shrink-0" />
              ) : (
                <CalendarOff size={12} className="text-muted shrink-0" />
              )}
              <span className="flex-1 min-w-0 truncate">
                {ruleDescription(rule)}
              </span>
              {rule.reason && (
                <span className="text-muted/60 truncate max-w-[100px]">
                  {rule.reason}
                </span>
              )}
              <button
                onClick={() => startEdit(rule)}
                className="p-0.5 text-muted hover:text-primary shrink-0"
                title="Edit rule"
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={() => handleDelete(rule.id)}
                className="p-0.5 text-muted hover:text-red-500 shrink-0"
                title="Delete rule"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Plus size={12} />
          Add schedule rule
        </button>
      ) : (
        <div className="border border-border rounded-lg p-3 space-y-3 bg-surface/50">
          {editingId && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-primary flex items-center gap-1">
                <Pencil size={10} />
                Editing rule
              </span>
              <button
                onClick={resetForm}
                className="text-[11px] text-muted hover:text-foreground"
              >
                Cancel edit
              </button>
            </div>
          )}
          <div>
            <label className="block text-[11px] text-muted mb-1">Type</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AvailabilityKind)}
              className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {kind === "role_assignment" && (
            <div>
              <label className="block text-[11px] text-muted mb-1">
                Department
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
              >
                <option value="">Select department...</option>
                {DEPARTMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted/60 mt-1">
                e.g. &quot;Service on Mon/Wed/Fri&quot; or &quot;Measure Tech on Tue/Thu&quot;
              </p>
            </div>
          )}

          <div>
            <label className="block text-[11px] text-muted mb-1">
              Days of week
            </label>
            <div className="flex gap-1">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => toggleDay(i)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    weekdays.includes(i)
                      ? "bg-primary text-white"
                      : "bg-surface border border-border text-muted hover:bg-border"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-muted mb-1">
              Repeat
            </label>
            <select
              value={monthly ? "monthly" : repeatInterval}
              onChange={(e) => {
                if (e.target.value === "monthly") {
                  setRepeatMode("monthly");
                } else {
                  setRepeatMode("weekly");
                  setRepeatInterval(Number(e.target.value));
                }
              }}
              className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
            >
              <option value={1}>Every week</option>
              <option value={2}>Every other week</option>
              <option value={3}>Every 3 weeks</option>
              <option value={4}>Every 4 weeks</option>
              <option value="monthly">Monthly pattern (e.g. first Friday)…</option>
            </select>

            {monthly && (
              <div className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <select
                    value={weekOfMonth}
                    onChange={(e) => setWeekOfMonth(Number(e.target.value))}
                    className="flex-1 border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
                    aria-label="Which occurrence in the month"
                  >
                    {WEEK_OF_MONTH_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={monthInterval}
                    onChange={(e) => setMonthInterval(Number(e.target.value))}
                    className="flex-1 border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
                    aria-label="How many months apart"
                  >
                    <option value={1}>of every month</option>
                    <option value={2}>of every other month</option>
                    <option value={3}>of every 3rd month</option>
                    <option value={4}>of every 4th month</option>
                    <option value={6}>of every 6th month</option>
                    <option value={12}>once a year</option>
                  </select>
                </div>
                <p className="text-[10px] text-muted/60">
                  Pick the day(s) above, e.g. Fri → &quot;First Fri of every other month&quot;.
                  {monthInterval > 1 &&
                    " Months are counted from the “Effective from” month below, so set that to the first month it should apply."}
                </p>
              </div>
            )}
          </div>

          {(kind === "late_day" || kind === "office_day" || kind === "special_ops") && (
            <div>
              <label className="flex items-center gap-2 text-[11px] text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  className="accent-primary"
                />
                Block the entire day
              </label>
              <p className="text-[10px] text-muted/60 mt-1">
                {allDay
                  ? "The whole day is blocked off, like time off."
                  : "Only the time window below is blocked; the rest of the day stays open."}
              </p>
            </div>
          )}

          {usesTimeWindow && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[11px] text-muted mb-1">
                  {kind === "block" ? "Start time" : "Block from"}
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] text-muted mb-1">
                  {kind === "block" ? "End time" : "Block until"}
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[11px] text-muted mb-1">
                Effective from
              </label>
              <input
                type="date"
                value={effectiveStart}
                min={DATE_INPUT_MIN}
                max={DATE_INPUT_MAX}
                onChange={(e) => setEffectiveStart(e.target.value)}
                className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-muted mb-1">
                Until (optional)
              </label>
              <input
                type="date"
                value={effectiveEnd}
                min={effectiveStart || DATE_INPUT_MIN}
                max={DATE_INPUT_MAX}
                onChange={(e) => setEffectiveEnd(e.target.value)}
                className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-muted mb-1">
              Reason (optional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. School pickup"
              className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
            />
          </div>

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={weekdays.length === 0 || saving}
              className={`flex-1 py-2 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1 ${
                editingId ? "bg-green-600" : "bg-primary"
              }`}
            >
              {editingId ? <Save size={12} /> : <Plus size={12} />}
              {saving ? "Saving..." : editingId ? "Save Changes" : "Save Rule"}
            </button>
            <button
              onClick={resetForm}
              disabled={saving}
              className="px-4 py-2 border border-border rounded-lg text-xs hover:bg-surface disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
