"use client";

import { useState, useCallback, useMemo } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Appointment, RForceOrder, FuzzyMatchCandidate } from "@/lib/types";
import {
  describeMergeConflicts,
  MergeChoices,
  MergeChoiceKey,
  MergeSide,
} from "@/lib/merge";
import { useData } from "./DataProvider";
import { X, GitMerge, Loader2 } from "lucide-react";

interface Props {
  appointment: Appointment;
  rforceOrder: RForceOrder;
  fuzzyMatch: FuzzyMatchCandidate;
  onConfirm: (choices: MergeChoices) => Promise<void>;
  onReject: () => void;
  onClose: () => void;
}

/**
 * Review screen for a suggested tile <-> rForce pairing. Fields where the two
 * disagree get a side-by-side pick: schedule fields (date / time / crew) default
 * to the app, text fields (address / name / type) default to rForce. Nothing
 * is written until the scheduler confirms.
 */
export default function MergeConfirmModal({
  appointment,
  rforceOrder,
  fuzzyMatch,
  onConfirm,
  onReject,
  onClose,
}: Props) {
  useEscapeKey(useCallback(() => onClose(), [onClose]));
  const { crews, resourceMappings } = useData();
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conflicts = useMemo(
    () => describeMergeConflicts(appointment, rforceOrder, crews, resourceMappings),
    [appointment, rforceOrder, crews, resourceMappings]
  );
  const [choices, setChoices] = useState<Partial<Record<MergeChoiceKey, MergeSide>>>(() =>
    Object.fromEntries(conflicts.map((c) => [c.key, c.defaultSide]))
  );

  // rForce-only additions: nothing to choose, the tile just gains them.
  const additions: { label: string; value: string }[] = [];
  if (rforceOrder.work_order_number && rforceOrder.work_order_number !== appointment.work_order_number) {
    additions.push({ label: "Work Order #", value: rforceOrder.work_order_number });
  }
  if (rforceOrder.order_number && rforceOrder.order_number !== appointment.order_number) {
    additions.push({ label: "Order #", value: rforceOrder.order_number });
  }
  if (rforceOrder.product_count != null && rforceOrder.product_count !== appointment.product_count) {
    additions.push({ label: "Products", value: String(rforceOrder.product_count) });
  }

  async function handleConfirm() {
    setMerging(true);
    setError(null);
    try {
      await onConfirm(choices);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.replace(/^(Error:\s*)?(SCHEDULING_CONFLICT|DUPLICATE_WO):\s*/, "").slice(0, 200));
      setMerging(false);
    }
  }

  const sideBtn = (key: MergeChoiceKey, side: MergeSide, text: string, label: string) => {
    const active = (choices[key] ?? "app") === side;
    return (
      <button
        type="button"
        onClick={() => setChoices((c) => ({ ...c, [key]: side }))}
        className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-md border text-xs transition-colors ${
          active
            ? "border-green-600 bg-green-50 dark:bg-green-900/20 text-foreground"
            : "border-border text-muted hover:bg-surface"
        }`}
        aria-pressed={active}
      >
        <div className="text-[9px] uppercase tracking-wide opacity-70">{label}</div>
        <div className="truncate font-medium" title={text}>{text}</div>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-xl w-full max-w-md border border-border animate-slide-up max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <GitMerge size={16} className="text-green-600" />
            <h2 className="font-semibold text-sm">Confirm Merge</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-surface text-muted">
            <X size={16} />
          </button>
        </div>

        {/* Match info */}
        <div className="px-4 py-3 bg-green-50 dark:bg-green-900/10 border-b border-border">
          <div className="text-xs text-green-700 dark:text-green-300 font-medium mb-1">
            {fuzzyMatch.confidence === "high" ? "High" : "Medium"} confidence match
            {" - "}
            {appointment.customer_name || "your tile"} &harr; {rforceOrder.customer_name || "rForce order"}
          </div>
          <div className="text-[10px] text-green-600 dark:text-green-400">
            {fuzzyMatch.matchReasons.join(" · ")}
          </div>
        </div>

        {/* Disagreements: pick a side */}
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
            {conflicts.length === 0 ? "Details agree" : "Where they differ - pick one"}
          </div>
          {conflicts.length === 0 ? (
            <div className="text-xs text-muted italic">Date, time, crew and details already match.</div>
          ) : (
            <div className="space-y-2.5">
              {conflicts.map((c) => (
                <div key={c.key}>
                  <div className="text-xs text-muted mb-1">{c.label}</div>
                  <div className="flex gap-1.5">
                    {sideBtn(c.key, "app", c.app, "Keep app")}
                    {sideBtn(c.key, "rforce", c.rforce, "Use rForce")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* rForce additions */}
        {additions.length > 0 && (
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
              Added from rForce
            </div>
            <div className="space-y-1 text-xs">
              {additions.map((a) => (
                <div key={a.label} className="flex justify-between gap-3">
                  <span className="text-muted">{a.label}</span>
                  <span className="font-medium truncate">{a.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="px-4 py-2 text-xs text-red-600 dark:text-red-400 border-b border-border">{error}</div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            onClick={handleConfirm}
            disabled={merging}
            className="flex-1 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {merging ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
            {merging ? "Merging..." : "Confirm Merge"}
          </button>
          <button
            onClick={() => {
              onReject();
              onClose();
            }}
            className="px-3 py-2 border border-border text-sm rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-muted hover:text-red-600 transition-colors"
            title="These are different jobs - remember that and let rForce create its own tile"
          >
            Not a match
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 border border-border text-sm rounded-lg hover:bg-surface text-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
