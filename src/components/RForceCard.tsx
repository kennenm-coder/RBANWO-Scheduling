"use client";

import { RForceOrder, Crew } from "@/lib/types";
import { parseCity } from "@/lib/crew-utils";
import { MapPin, AlertTriangle } from "lucide-react";

interface Props {
  order: RForceOrder;
  crew?: Crew;
  compact?: boolean;
  onClick?: () => void;
}

export default function RForceCard({ order, crew, compact, onClick }: Props) {
  const borderColor = crew?.color || "#888";
  const city = parseCity(order.address || "");
  const hasAlerts = !!(order.order_alerts || order.scheduler_notes);

  return (
    <div
      onClick={onClick}
      className="rounded-lg p-2 cursor-pointer hover:shadow-md transition-shadow text-xs leading-tight overflow-hidden border-2 border-dashed"
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
          className="text-[9px] font-normal ml-auto shrink-0 px-1 rounded"
          style={{ backgroundColor: `${borderColor}30`, color: borderColor }}
        >
          rForce
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
            {order.product_count != null && order.product_count > 0 && (
              <span>
                {order.product_count} units
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
