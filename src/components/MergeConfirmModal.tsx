"use client";

import { useState, useCallback } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Appointment, RForceOrder, FuzzyMatchCandidate } from "@/lib/types";
import { normalizeWoType } from "@/lib/normalize";
import { X, GitMerge, ArrowRight, Loader2 } from "lucide-react";

interface Props {
  appointment: Appointment;
  rforceOrder: RForceOrder;
  fuzzyMatch: FuzzyMatchCandidate;
  onConfirm: () => Promise<void>;
  onReject: () => void;
  onClose: () => void;
}

/**
 * Shows a preview of what will change when merging an rForce order
 * into an existing app appointment. Scheduler must confirm.
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
  const [merging, setMerging] = useState(false);

  // Compute what will change (mirrors merge.ts logic)
  const changes: { field: string; label: string; from: string; to: string }[] = [];

  if (
    rforceOrder.work_order_number &&
    rforceOrder.work_order_number !== appointment.work_order_number
  ) {
    changes.push({
      field: "work_order_number",
      label: "Work Order #",
      from: appointment.work_order_number || "(none)",
      to: rforceOrder.work_order_number,
    });
  }

  if (
    rforceOrder.order_number &&
    rforceOrder.order_number !== appointment.order_number
  ) {
    changes.push({
      field: "order_number",
      label: "Order #",
      from: appointment.order_number || "(none)",
      to: rforceOrder.order_number,
    });
  }

  if (rforceOrder.address && rforceOrder.address !== appointment.address) {
    changes.push({
      field: "address",
      label: "Address",
      from: appointment.address || "(none)",
      to: rforceOrder.address,
    });
  }

  if (
    rforceOrder.customer_name &&
    rforceOrder.customer_name !== appointment.customer_name
  ) {
    changes.push({
      field: "customer_name",
      label: "Customer",
      from: appointment.customer_name || "(none)",
      to: rforceOrder.customer_name,
    });
  }

  const mappedType = normalizeWoType(rforceOrder.work_order_type);
  if (mappedType !== null && mappedType !== appointment.appointment_type) {
    changes.push({
      field: "appointment_type",
      label: "Type",
      from: appointment.appointment_type,
      to: mappedType,
    });
  }

  if (rforceOrder.product_count != null) {
    changes.push({
      field: "product_count",
      label: "Products",
      from: String(appointment.product_count ?? "(none)"),
      to: String(rforceOrder.product_count),
    });
  }

  async function handleConfirm() {
    setMerging(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      setMerging(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-xl w-full max-w-md border border-border animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <GitMerge size={16} className="text-green-600" />
            <h2 className="font-semibold text-sm">Confirm Merge</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-surface text-muted"
          >
            <X size={16} />
          </button>
        </div>

        {/* Match info */}
        <div className="px-4 py-3 bg-green-50 dark:bg-green-900/10 border-b border-border">
          <div className="text-xs text-green-700 dark:text-green-300 font-medium mb-1">
            {fuzzyMatch.confidence === "high" ? "High" : "Medium"} confidence match
          </div>
          <div className="text-[10px] text-green-600 dark:text-green-400">
            {fuzzyMatch.matchReasons.join(" · ")}
          </div>
        </div>

        {/* What stays (manual wins) */}
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
            Kept from your entry (manual wins)
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Crew</span>
              <span className="font-medium">{appointment.crew_id ? "Current crew" : "(unassigned)"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Date</span>
              <span className="font-medium">{appointment.scheduled_date || "(unscheduled)"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Time</span>
              <span className="font-medium">{appointment.time_block || "(none)"}</span>
            </div>
          </div>
        </div>

        {/* What changes (rForce wins) */}
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
            Updated from rForce ({changes.length} field{changes.length !== 1 ? "s" : ""})
          </div>
          {changes.length === 0 ? (
            <div className="text-xs text-muted italic">No field changes — only link will be created</div>
          ) : (
            <div className="space-y-1.5">
              {changes.map((c) => (
                <div key={c.field} className="text-xs">
                  <div className="text-muted mb-0.5">{c.label}</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-red-500 dark:text-red-400 line-through truncate max-w-[140px]" title={c.from}>
                      {c.from}
                    </span>
                    <ArrowRight size={10} className="text-muted shrink-0" />
                    <span className="text-green-600 dark:text-green-400 font-medium truncate max-w-[140px]" title={c.to}>
                      {c.to}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            onClick={handleConfirm}
            disabled={merging}
            className="flex-1 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {merging ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <GitMerge size={14} />
            )}
            {merging ? "Merging..." : "Confirm Merge"}
          </button>
          <button
            onClick={() => {
              onReject();
              onClose();
            }}
            className="px-3 py-2 border border-border text-sm rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-muted hover:text-red-600 transition-colors"
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
