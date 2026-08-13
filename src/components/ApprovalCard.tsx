"use client";

import { RForceOrder, Crew } from "@/lib/types";
import { formatProductBreakdown } from "@/lib/calendar-utils";
import { parseCity } from "@/lib/crew-utils";
import { Check, X, MapPin } from "lucide-react";
import { useState } from "react";

interface Props {
  rforceOrder: RForceOrder;
  crew?: Crew;
  compact?: boolean;
  onApprove: () => Promise<void>;
  onDismiss: () => Promise<void>;
  onClick?: () => void;
}

export default function ApprovalCard({
  rforceOrder,
  crew,
  compact,
  onApprove,
  onDismiss,
  onClick,
}: Props) {
  const [loading, setLoading] = useState(false);
  const borderColor = crew?.color || "#888";
  const city = parseCity(rforceOrder.address || "");

  async function handleApprove(e: React.MouseEvent) {
    e.stopPropagation();
    setLoading(true);
    try {
      await onApprove();
    } finally {
      setLoading(false);
    }
  }

  async function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setLoading(true);
    try {
      await onDismiss();
    } finally {
      setLoading(false);
    }
  }

  if (compact) {
    return (
      <div
        onClick={onClick}
        className="rounded-lg p-1.5 cursor-pointer text-xs leading-tight overflow-hidden border-2 border-dashed"
        style={{
          borderColor,
          backgroundColor: `${borderColor}18`,
        }}
      >
        <div className="font-semibold truncate flex items-center gap-1 text-foreground">
          {rforceOrder.customer_name || "Unknown"}
          <span className="text-[6px] opacity-50 font-normal ml-auto bg-amber-200 dark:bg-amber-800 px-0.5 rounded text-amber-800 dark:text-amber-200">
            NEW
          </span>
        </div>
        {city && (
          <div className="truncate opacity-70 text-foreground/70 text-[10px]">{city}</div>
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
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="rounded-lg p-2 cursor-pointer hover:shadow-md transition-shadow text-xs leading-tight overflow-hidden h-full border-2 border-dashed"
      style={{
        borderColor,
        backgroundColor: `${borderColor}18`,
      }}
    >
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
    </div>
  );
}
