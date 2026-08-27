"use client";

import { RForceOrder, Crew } from "@/lib/types";
import { formatProductBreakdown } from "@/lib/calendar-utils";
import { parseCity } from "@/lib/crew-utils";
import { Check, X, MapPin, AlertTriangle } from "lucide-react";
import { useState } from "react";

/** Extract a readable message from Errors and raw Supabase/Postgrest error objects. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean);
    if (parts.length) return parts.join(" — ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

interface Props {
  rforceOrder: RForceOrder;
  crew?: Crew;
  compact?: boolean;
  /** Order missed ≥1 daily export — amber "possible cancel" tag. */
  stale?: boolean;
  /** Escalation tier: `likely_cancel` (missed ≥2 exports) shows red instead of amber. */
  dropTier?: "present" | "possible_cancel" | "likely_cancel";
  /** override bypasses the double-booking guard (intentional same-slot overlap). */
  onApprove: (override?: boolean) => Promise<void>;
  onDismiss: () => Promise<void>;
  onClick?: () => void;
}

export default function ApprovalCard({
  rforceOrder,
  crew,
  compact,
  stale,
  dropTier,
  onApprove,
  onDismiss,
  onClick,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  // "double_book" → same crew booked into the same slot: an override can place
  // both here. "duplicate" → this same job is already on the calendar elsewhere:
  // there's nothing to override; the fix is to move the existing one.
  const [conflictKind, setConflictKind] = useState<"double_book" | "duplicate" | null>(null);
  const [override, setOverride] = useState(false);
  const borderColor = crew?.color || "#888";
  const city = parseCity(rforceOrder.address || "");
  // Drop escalation: red once the order has missed enough exports to be a likely
  // cancel, amber on the first miss. `stale` remains the "show a warning" gate.
  const likelyCancel = dropTier === "likely_cancel";
  const warnBorder = likelyCancel ? "border-red-500" : "border-amber-500";

  async function runApprove(useOverride: boolean) {
    setLoading(true);
    setError(null);
    try {
      await onApprove(useOverride);
      setConflict(null);
      setConflictKind(null);
      setOverride(false);
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes("SCHEDULING_CONFLICT") || msg.includes("DOUBLE_BOOK")) {
        setConflictKind("double_book");
        setConflict(
          msg.replace(/^(Error:\s*)?SCHEDULING_CONFLICT:\s*/, "").replace(/^DOUBLE_BOOK$/, "That crew slot is already booked.").slice(0, 200)
        );
      } else if (msg.includes("DUPLICATE_WO")) {
        setConflictKind("duplicate");
        setConflict(msg.replace(/^(Error:\s*)?DUPLICATE_WO:\s*/, "").slice(0, 200));
      } else {
        setError(msg.slice(0, 80));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(e: React.MouseEvent) {
    e.stopPropagation();
    await runApprove(false);
  }

  async function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setLoading(true);
    try {
      await onDismiss();
    } catch (err: unknown) {
      setError(errorMessage(err).slice(0, 80));
    } finally {
      setLoading(false);
    }
  }

  function closeConflict() {
    if (loading) return;
    setConflict(null);
    setConflictKind(null);
    setOverride(false);
    setError(null);
  }

  const isDouble = conflictKind === "double_book";
  const customer = rforceOrder.customer_name || "This order";

  const overrideModal =
    conflict !== null ? (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
        onClick={(e) => {
          e.stopPropagation();
          closeConflict();
        }}
      >
        <div
          className="w-full max-w-sm rounded-lg border border-border bg-background p-4 text-foreground shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500 shrink-0" />
            <h3 className="text-sm font-semibold">
              {isDouble ? "Slot already booked" : "Already on the calendar"}
            </h3>
          </div>
          <p className="mb-1 text-xs text-foreground/80">
            {isDouble
              ? `You're placing ${customer} where the crew is already booked:`
              : `${customer} can't be approved again:`}
          </p>
          <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs">
            {conflict}
          </p>

          {isDouble ? (
            <>
              <label className="mb-3 flex cursor-pointer items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                  className="mt-0.5 shrink-0"
                />
                <span>Yes, book both here on purpose (allow the overlap).</span>
              </label>
              {error && <div className="mb-2 text-[11px] text-red-500">{error}</div>}
              <div className="flex gap-2">
                <button
                  disabled={!override || loading}
                  onClick={() => runApprove(true)}
                  className="flex-1 rounded-md bg-amber-500 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-40"
                >
                  {loading ? "Saving…" : "Save override"}
                </button>
                <button
                  disabled={loading}
                  onClick={closeConflict}
                  className="flex-1 rounded-md bg-muted/20 py-1.5 text-xs transition-colors hover:bg-muted/40 disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 text-xs text-foreground/70">
                To put it on this date instead, open the existing appointment and reschedule it — that moves the one job rather than creating a duplicate.
              </p>
              <button
                onClick={closeConflict}
                className="w-full rounded-md bg-muted/20 py-1.5 text-xs transition-colors hover:bg-muted/40"
              >
                Got it
              </button>
            </>
          )}
        </div>
      </div>
    ) : null;

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`rounded-lg p-1.5 cursor-pointer text-xs leading-tight overflow-hidden border-2 border-dashed ${stale ? warnBorder : ""}`}
        style={{
          borderColor: stale ? undefined : borderColor,
          backgroundColor: `${borderColor}18`,
        }}
      >
        {stale && (
          <div className={`text-[8px] font-semibold truncate flex items-center gap-0.5 ${likelyCancel ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>
            <AlertTriangle size={8} className="shrink-0" /> {likelyCancel ? "Likely cancelled" : "Not in latest rForce"}
          </div>
        )}
        <div className="font-semibold truncate flex items-center gap-1 text-foreground">
          {rforceOrder.customer_name || "Unknown"}
          <span className={`text-[6px] opacity-50 font-normal ml-auto px-0.5 rounded ${likelyCancel ? "bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200" : "bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200"}`}>
            {stale ? "CXL?" : "NEW"}
          </span>
        </div>
        {city && (
          <div className="truncate opacity-70 text-foreground/70 text-[10px]">{city}</div>
        )}
        {error && (
          <div className="text-[8px] text-red-500 truncate mt-0.5">{error}</div>
        )}
        <div className="flex gap-1 mt-1">
          <button
            onClick={handleApprove}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-0.5 rounded bg-green-500 hover:bg-green-600 text-white text-[9px] py-0.5 transition-colors disabled:opacity-50"
          >
            <Check size={8} />
          </button>
          <button
            onClick={handleDismiss}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-0.5 rounded bg-muted/20 hover:bg-muted/40 text-muted text-[9px] py-0.5 transition-colors disabled:opacity-50"
          >
            <X size={8} />
          </button>
        </div>
        {overrideModal}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`rounded-lg p-2 cursor-pointer hover:shadow-md transition-shadow text-xs leading-tight overflow-hidden h-full border-2 border-dashed ${stale ? warnBorder : ""}`}
      style={{
        borderColor: stale ? undefined : borderColor,
        backgroundColor: `${borderColor}18`,
      }}
    >
      {stale && (
        <div className={`mb-1 flex items-start gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-snug ${likelyCancel ? "bg-red-400/25 text-red-800 dark:text-red-200" : "bg-amber-400/25 text-amber-800 dark:text-amber-200"}`}>
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span>{likelyCancel ? "Missed 2+ rForce exports — likely cancelled" : "Not in latest rForce export — possible cancel"}</span>
        </div>
      )}
      <div className="font-semibold truncate flex items-center gap-1 text-foreground">
        {rforceOrder.customer_name || "Unknown"}
        <span className="text-[9px] opacity-70 font-normal ml-auto shrink-0 bg-amber-200 dark:bg-amber-800 px-1 rounded text-amber-800 dark:text-amber-200">
          rForce · Approve?
        </span>
      </div>
      {rforceOrder.account_name && (
        <div className="truncate opacity-70 text-foreground/70 text-[10px] leading-snug">
          {rforceOrder.account_name}
        </div>
      )}
      <div className="flex items-center gap-1 mt-0.5 opacity-80 text-foreground/80">
        <MapPin size={10} />
        <span className="truncate">{rforceOrder.address}</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="opacity-70 text-foreground/70">
          {rforceOrder.work_order_type || "Unknown"}
        </span>
        {formatProductBreakdown(rforceOrder) && (
          <span className="opacity-70 text-foreground/70">
            {formatProductBreakdown(rforceOrder)}
          </span>
        )}
      </div>
      {error && (
        <div className="text-[9px] text-red-500 mt-1">{error}</div>
      )}
      <div className="flex gap-2 mt-2">
        <button
          onClick={handleApprove}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-1 rounded-md bg-green-500 hover:bg-green-600 text-white text-[11px] font-medium py-1.5 transition-colors disabled:opacity-50"
        >
          <Check size={12} />
          Approve
        </button>
        <button
          onClick={handleDismiss}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-1 rounded-md bg-muted/20 hover:bg-muted/40 text-muted text-[11px] font-medium py-1.5 transition-colors disabled:opacity-50"
        >
          <X size={12} />
          Dismiss
        </button>
      </div>
      {overrideModal}
    </div>
  );
}
