"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";

interface Props {
  /** Human sentence describing the conflict (who/when is already booked). */
  message: string;
  /** Runs the move again with the overlap override. Should resolve when done. */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  /** Dialog heading. Defaults to the double-booking wording. */
  title?: string;
  /** Line shown above the highlighted message. */
  intro?: string;
  /** Checkbox label the scheduler must tick to enable the override. */
  checkboxLabel?: string;
}

/**
 * Shown after a drag/drop or reschedule lands on an already-booked slot. Lets the
 * scheduler intentionally double-book by confirming the overlap, which re-runs the
 * move tagged `allow_overlap`. Mirrors the rForce-approval override flow so the two
 * paths behave the same way.
 */
export default function OverlapOverrideDialog({
  message,
  onConfirm,
  onCancel,
  title = "Slot already booked",
  intro = "The crew is already booked here:",
  checkboxLabel = "Yes, book both here on purpose (allow the overlap).",
}: Props) {
  const [override, setOverride] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)).slice(0, 120));
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-background p-4 text-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500 shrink-0" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <p className="mb-1 text-xs text-foreground/80">
          {intro}
        </p>
        <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs">
          {message}
        </p>

        <label className="mb-3 flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            className="mt-0.5 shrink-0"
          />
          <span>{checkboxLabel}</span>
        </label>
        {error && <div className="mb-2 text-[11px] text-red-500">{error}</div>}
        <div className="flex gap-2">
          <button
            disabled={!override || loading}
            onClick={confirm}
            className="flex-1 rounded-md bg-amber-500 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-40"
          >
            {loading ? "Saving…" : "Save override"}
          </button>
          <button
            disabled={loading}
            onClick={onCancel}
            className="flex-1 rounded-md bg-muted/20 py-1.5 text-xs transition-colors hover:bg-muted/40 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
