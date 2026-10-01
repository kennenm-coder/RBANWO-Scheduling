"use client";

import { addDays, format, parseISO } from "date-fns";

/**
 * Picks which days of a multi-day job a helper crew covers.
 *
 * Off by default, and off means the whole job — the way helpers have always
 * worked. Switching it on reveals one tile per day of the span to toggle;
 * non-contiguous picks are fine (day 1 and day 3, skipping day 2).
 *
 * On a one-day job it still shows, disabled, with a line saying why. There is
 * nothing to split there, but hiding the control outright made the whole
 * feature look missing to anyone who happened to open a one-day install first.
 */
export default function HelperDayPicker({
  label,
  durationDays,
  scheduledDate,
  offsets,
  onChange,
}: {
  label: string;
  durationDays: number;
  /** Start of the span, YYYY-MM-DD — used to label each tile with its date. */
  scheduledDate: string | null;
  /** 0-based day positions, or null for the whole span. */
  offsets: number[] | null;
  onChange: (offsets: number[] | null) => void;
}) {
  const span = Math.max(1, durationDays);
  const singleDay = span < 2;

  // Out-of-range entries are ignored rather than shown — a job shortened under
  // a helper booked for its old last day shouldn't render a phantom tile.
  const selected = (offsets ?? []).filter((i) => i >= 0 && i < span);
  const partial = selected.length > 0;

  const dayLabel = (i: number): string => {
    if (!scheduledDate) return `Day ${i + 1}`;
    try {
      return format(addDays(parseISO(scheduledDate), i), "EEE M/d");
    } catch {
      return `Day ${i + 1}`;
    }
  };

  const toggle = (i: number) => {
    const next = selected.includes(i)
      ? selected.filter((d) => d !== i)
      : [...selected, i];
    // Clearing the last day would mean "on no days at all", which we store as
    // the whole span. Keep the tile on instead so the intent stays visible.
    if (next.length === 0) return;
    // Deliberately NOT normalized here: turning every day back on would collapse
    // to null mid-edit and the picker would fold itself away under the cursor.
    // "All days" and "whole span" mean the same thing, so the save path
    // normalizes once, at the end.
    onChange([...next].sort((a, b) => a - b));
  };

  if (singleDay) {
    return (
      <div className="mt-2">
        <label className="flex items-center gap-2 text-xs text-muted/60 cursor-not-allowed">
          <input
            type="checkbox"
            checked={false}
            disabled
            readOnly
            className="rounded border-border"
          />
          Only on certain days
        </label>
        <p className="text-[10px] text-muted mt-1">
          This job is one day long, so there are no days to choose between —
          {" "}{label} works it. Set a duration of 2 or more to split a helper
          across part of the job.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
        <input
          type="checkbox"
          checked={partial}
          onChange={(e) =>
            // Switching on starts from the whole span so nothing is lost by a
            // stray click; the scheduler then turns days off.
            onChange(e.target.checked ? Array.from({ length: span }, (_, i) => i) : null)
          }
          className="rounded border-border"
        />
        Only on certain days
      </label>

      {partial && (
        <>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Array.from({ length: span }, (_, i) => i).map((i) => {
              const on = selected.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggle(i)}
                  aria-pressed={on}
                  className={`px-2 py-1 rounded-md text-[11px] border transition-colors ${
                    on
                      ? "bg-primary text-white border-primary"
                      : "bg-background text-muted border-border hover:border-primary/50"
                  }`}
                >
                  <span className="font-medium">Day {i + 1}</span>
                  <span className="opacity-75"> · {dayLabel(i)}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted mt-1">
            {label} is only booked on the highlighted days — the rest of the span
            stays free for other work.
          </p>
        </>
      )}
    </div>
  );
}
