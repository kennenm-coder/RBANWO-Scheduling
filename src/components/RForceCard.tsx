"use client";

import { RForceOrder, Crew } from "@/lib/types";
import { formatProductBreakdown } from "@/lib/calendar-utils";
import { parseCity } from "@/lib/crew-utils";
import { MapPin, AlertTriangle, Check } from "lucide-react";

interface Props {
  order: RForceOrder;
  crew?: Crew;
  compact?: boolean;
  isSynced?: boolean;
  onClick?: () => void;
}

export default function RForceCard({ order, crew, compact, isSynced, onClick }: Props) {
  const borderColor = crew?.color || "#888";
  const city = parseCity(order.address || "");
  const hasAlerts = !!(order.order_alerts || order.scheduler_notes);

  return (
    <div
      onClick={onClick}
      className={`rounded-lg p-2 cursor-pointer hover:shadow-md transition-shadow text-xs leading-tight overflow-hidden border-2 ${
        isSynced ? "border-solid opacity-60" : "border-dashed"
      }`}
      style={{ borderColor, backgroundColor: `${borderColor}15` }}
    >
      {hasAlerts && (
        <div className="flex items-start gap-1 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded px-1.5 py-0.5 mb-1 text-[10px] leading-snug">
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span className="line-clamp-2">{order.order_alerts || order.scheduler_notes}</span>
        </div>
      )}
      <div className="font-semibold truncate flex items-center gap-1 text-foreground">
        {order.customer_name || "Unknown"}
        <span
          className={`text-[9px] font-normal ml-auto shrink-0 px-1 rounded flex items-center gap-0.5 ${
            isSynced ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300" : ""
          }`}
          style={isSynced ? undefined : { backgroundColor: `${borderColor}30`, color: borderColor }}
        >
          {isSynced && <Check size={8} />}
          {isSynced ? "rF ✓" : "rForce"}
        </span>
      </div>
      {order.account_name && (
        <div className="truncate text-foreground/60 text-[10px] leading-snug">{order.account_name}</div>
      )}
      {compact ? (
        city && <div className="truncate text-foreground/70 mt-0.5">{city}</div>
      ) : (
        <>
          <div className="flex items-center gap-1 mt-0.5 text-foreground/70">
            <MapPin size={10} />
            <span className="truncate">{order.address}</span>
          </div>
          <div className="flex items-center justify-between mt-1 text-foreground/60">
            <span>
              {order.work_order_type || "Unknown"}
            </span>
            {formatProductBreakdown(order) && (
              <span>
                {formatProductBreakdown(order)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
