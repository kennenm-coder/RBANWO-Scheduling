"use client";

import { useState, useCallback } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { RForceOrder, Crew } from "@/lib/types";
import { openSalesforce, mapsHref } from "@/lib/salesforce";
import { updateSchedulerNotes } from "@/lib/store";
import { parseCity } from "@/lib/crew-utils";
import { formatDateStr, formatProductBreakdown, formatProductShort } from "@/lib/calendar-utils";
import { useData } from "./DataProvider";
import ScheduleModal from "./ScheduleModal";
import {
  X,
  MapPin,
  ExternalLink,
  Calendar,
  Hash,
  User,
  Phone,
  Package,
  Link2,
  AlertTriangle,
  MessageSquare,
  Save,
  Check,
} from "lucide-react";

/** Readable message from Errors and raw Supabase/Postgrest error objects. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean);
    if (parts.length) return parts.join(" — ");
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}

interface Props {
  order: RForceOrder;
  crew?: Crew;
  onClose: () => void;
  /** Order hasn't appeared in recent imports — likely cancelled in rForce. */
  stale?: boolean;
  /** override bypasses the double-booking guard (intentional same-slot overlap). */
  onApprove?: (override?: boolean) => Promise<void>;
  onDismiss?: () => Promise<void>;
}

export default function RForceDetailSheet({ order, crew, onClose, stale, onApprove, onDismiss }: Props) {
  const { refreshData } = useData();
  useEscapeKey(useCallback(() => onClose(), [onClose]));
  const [scheduling, setScheduling] = useState(false);
  const [notes, setNotes] = useState(order.scheduler_notes || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [conflictKind, setConflictKind] = useState<"double_book" | "duplicate" | null>(null);
  const [override, setOverride] = useState(false);

  const city = parseCity(order.address || "");

  async function runApprove(useOverride: boolean) {
    if (!onApprove) return;
    setApproving(true);
    setError(null);
    try {
      await onApprove(useOverride);
      onClose();
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes("SCHEDULING_CONFLICT") || msg.includes("DOUBLE_BOOK")) {
        setConflictKind("double_book");
        setConflict(
          msg.replace(/^(Error:\s*)?SCHEDULING_CONFLICT:\s*/, "").replace(/^DOUBLE_BOOK$/, "That crew slot is already booked.").slice(0, 220)
        );
      } else if (msg.includes("DUPLICATE_WO")) {
        setConflictKind("duplicate");
        setConflict(msg.replace(/^(Error:\s*)?DUPLICATE_WO:\s*/, "").slice(0, 220));
      } else {
        setError(msg.slice(0, 140));
      }
    } finally {
      setApproving(false);
    }
  }

  function closeConflict() {
    if (approving) return;
    setConflict(null);
    setConflictKind(null);
    setOverride(false);
    setError(null);
  }

  const handleSaveNotes = async () => {
    setSaving(true);
    const ok = await updateSchedulerNotes(order.id, notes);
    setSaving(false);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      refreshData();
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-background rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto animate-slide-up safe-area-bottom">
          <div className="sticky top-0 bg-background p-4 flex items-center justify-between border-b border-border z-10">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">rForce Order</h2>
              <span className="text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200 px-2 py-0.5 rounded-full font-medium">
                Imported from rForce — not yet linked
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-full hover:bg-surface"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {stale && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-400/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-xs mb-0.5">Not in latest rForce import</div>
                  This order hasn&apos;t appeared in recent imports{order.updated_at ? ` (last seen ${formatDateStr(order.updated_at.slice(0, 10))})` : ""} — it was likely cancelled or rescheduled in rForce. Verify before approving; dismiss it if it&apos;s gone.
                </div>
              </div>
            )}
            {order.order_alerts && (
              <div className="flex items-start gap-2 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded-lg px-3 py-2 text-sm">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-xs mb-0.5">rForce Alert</div>
                  {order.order_alerts}
                </div>
              </div>
            )}

            <div>
              <div className="text-xl font-bold">
                {order.customer_name || "Unknown Customer"}
              </div>
              {order.work_order_type && (
                <span
                  className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white mt-1"
                  style={{ backgroundColor: crew?.color || "#888" }}
                >
                  {order.work_order_type}
                </span>
              )}
            </div>

            {crew && (
              <InfoRow icon={<User size={16} />} label="Assigned Resource">
                {crew.name}
              </InfoRow>
            )}

            {order.scheduled_start && (
              <InfoRow icon={<Calendar size={16} />} label="Scheduled">
                {formatDateStr(order.scheduled_start.slice(0, 10))}
                {order.scheduled_end &&
                  order.scheduled_end.slice(0, 10) !== order.scheduled_start.slice(0, 10) &&
                  ` – ${formatDateStr(order.scheduled_end.slice(0, 10))}`}
              </InfoRow>
            )}

            {order.address && (
              <InfoRow icon={<MapPin size={16} />} label="Address">
                <a
                  href={mapsHref(order.address)}
                  target="_blank"
                  rel="noopener"
                  className="text-primary underline"
                >
                  {order.address}
                </a>
              </InfoRow>
            )}

            <InfoRow icon={<Hash size={16} />} label="Work Order">
              {order.work_order_number}
            </InfoRow>

            <InfoRow icon={<Hash size={16} />} label="Order">
              {order.order_number}
            </InfoRow>

            {order.wo_status && (
              <InfoRow icon={<Hash size={16} />} label="WO Status">
                {order.wo_status}
              </InfoRow>
            )}

            {order.product_count != null && order.product_count > 0 && (
              <InfoRow icon={<Package size={16} />} label="Products">
                {order.product_count} units
                {formatProductShort(order) && (
                  <span className="text-muted ml-1">
                    {formatProductShort(order)}
                  </span>
                )}
              </InfoRow>
            )}

            {order.phones && order.phones.length > 0 && (
              <InfoRow icon={<Phone size={16} />} label="Phone">
                {order.phones.map((p) => `${p.label}: ${p.number}`).join(", ")}
              </InfoRow>
            )}

            {order.description && (
              <InfoRow icon={<Hash size={16} />} label="Description">
                {order.description}
              </InfoRow>
            )}

            <div className="pt-4 border-t border-border space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquare size={14} className="text-muted" />
                Scheduler Notes
              </div>
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
                placeholder="Add notes for the scheduling team..."
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm resize-none"
                rows={3}
              />
              <button
                onClick={handleSaveNotes}
                disabled={saving || (notes === (order.scheduler_notes || ""))}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Save size={12} />
                {saving ? "Saving..." : saved ? "Saved!" : "Save Notes"}
              </button>
            </div>

            {onApprove && onDismiss && error && (
              <div className="text-xs text-red-500 border-t border-border pt-3">{error}</div>
            )}
            {onApprove && onDismiss && (
              <div className={`flex gap-2 ${error ? "pt-2" : "pt-4 border-t border-border"}`}>
                <button
                  onClick={() => runApprove(false)}
                  disabled={approving}
                  className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  <Check size={16} />
                  {approving ? "Approving..." : "Approve"}
                </button>
                <button
                  onClick={async () => {
                    setApproving(true);
                    try {
                      await onDismiss();
                      onClose();
                    } finally {
                      setApproving(false);
                    }
                  }}
                  disabled={approving}
                  className="flex-1 py-2.5 border border-border rounded-lg font-medium hover:bg-surface flex items-center justify-center gap-2 text-sm disabled:opacity-50 transition-colors"
                >
                  <X size={16} />
                  Dismiss
                </button>
              </div>
            )}

            <div className={`flex gap-2 ${onApprove ? "pt-2" : "pt-4 border-t border-border"}`}>
              <button
                onClick={() => setScheduling(true)}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 flex items-center justify-center gap-2"
              >
                <Link2 size={16} />
                Schedule / Link
              </button>
              <button
                onClick={() =>
                  openSalesforce(order.work_order_number, order.order_number)
                }
                className="px-4 py-2.5 border border-border rounded-lg font-medium hover:bg-surface flex items-center gap-2 text-sm"
              >
                <ExternalLink size={16} />
                Open in rForce
              </button>
            </div>
          </div>
        </div>
      </div>

      {conflict !== null && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={closeConflict}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-background p-4 text-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500 shrink-0" />
              <h3 className="text-sm font-semibold">
                {conflictKind === "double_book" ? "Slot already booked" : "Already on the calendar"}
              </h3>
            </div>
            <p className="mb-1 text-xs text-foreground/80">
              {conflictKind === "double_book"
                ? `You're placing ${order.customer_name || "this order"} where the crew is already booked:`
                : `${order.customer_name || "This order"} can't be approved again:`}
            </p>
            <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs">
              {conflict}
            </p>

            {conflictKind === "double_book" ? (
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
                    disabled={!override || approving}
                    onClick={() => runApprove(true)}
                    className="flex-1 rounded-md bg-amber-500 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-40"
                  >
                    {approving ? "Saving…" : "Save override"}
                  </button>
                  <button
                    disabled={approving}
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
      )}

      {scheduling && (
        <ScheduleModal
          date={
            order.scheduled_start
              ? new Date(order.scheduled_start.slice(0, 10))
              : new Date()
          }
          prefill={order}
          onClose={() => {
            setScheduling(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-muted mt-0.5">{icon}</div>
      <div>
        <div className="text-xs text-muted">{label}</div>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}
