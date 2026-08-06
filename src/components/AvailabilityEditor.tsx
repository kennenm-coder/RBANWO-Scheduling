"use client";

import { useState, useEffect } from "react";
import { AvailabilityRule, AvailabilityKind } from "@/lib/types";
import {
  fetchAvailabilityRules,
  upsertAvailabilityRule,
  deleteAvailabilityRule,
} from "@/lib/store";
import { Plus, Trash2, Clock, Ban, CalendarOff } from "lucide-react";
import { format } from "date-fns";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const KIND_OPTIONS: { value: AvailabilityKind; label: string }[] = [
  { value: "unavailable", label: "Day Off" },
  { value: "block", label: "Custom Hours" },
];

function ruleDescription(rule: AvailabilityRule): string {
  const days = rule.weekdays.length > 0
    ? rule.weekdays.map((d) => DAY_LABELS[d]).join(", ")
    : "All days";

  const interval =
    rule.repeat_interval === 2
      ? " (every other week)"
      : rule.repeat_interval > 2
        ? ` (every ${rule.repeat_interval} weeks)`
        : "";

  if (rule.kind === "unavailable" || rule.kind === "pto") {
    if (rule.start_time && rule.end_time) {
      return `Unavailable ${rule.start_time}–${rule.end_time} on ${days}${interval}`;
    }
    return `Off on ${days}${interval}`;
  }

  if (rule.kind === "block" && rule.start_time && rule.end_time) {
    return `Works ${rule.start_time}–${rule.end_time} on ${days}${interval}`;
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
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("18:00");
  const [effectiveStart, setEffectiveStart] = useState(
    format(new Date(), "yyyy-MM-dd")
  );
  const [effectiveEnd, setEffectiveEnd] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setWeekdays([]);
    setRepeatInterval(1);
    setStartTime("08:00");
    setEndTime("18:00");
    setEffectiveStart(format(new Date(), "yyyy-MM-dd"));
    setEffectiveEnd("");
    setReason("");
    setAdding(false);
  }

  async function handleSave() {
    if (weekdays.length === 0) return;
    setSaving(true);
    setError(null);

    try {
      await upsertAvailabilityRule({
        crew_id: crewId,
        kind,
        weekdays,
        repeat_interval: repeatInterval,
        start_time: kind === "block" ? startTime : null,
        end_time: kind === "block" ? endTime : null,
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
              {rule.kind === "block" ? (
                <Clock size={12} className="text-blue-500 shrink-0" />
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
                onClick={() => handleDelete(rule.id)}
                className="p-0.5 text-muted hover:text-red-500 shrink-0"
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
              value={repeatInterval}
              onChange={(e) => setRepeatInterval(Number(e.target.value))}
              className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-background"
            >
              <option value={1}>Every week</option>
              <option value={2}>Every other week</option>
              <option value={3}>Every 3 weeks</option>
              <option value={4}>Every 4 weeks</option>
            </select>
          </div>

          {kind === "block" && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[11px] text-muted mb-1">
                  Start time
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
                  End time
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
              className="flex-1 py-2 bg-primary text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Rule"}
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
