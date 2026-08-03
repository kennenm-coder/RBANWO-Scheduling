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
      className="rounded-lg p-2 cursor-pointer hover:shadow-md transition-shadow text-xs leading-tight overflow-hidden text-white"
      style={{ backgroundColor: borderColor }}
    >
      {hasAlerts && (
        <div className="flex items-start gap-1 bg-yellow-400/30 text-yellow-100 rounded px-1.5 py-0.5 mb-1 text-[10px] leading-snug">
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span className="line-clamp-2">{order.order_alerts || order.scheduler_notes}</span>
        </div>
      )}
      <div className="font-semibold truncate flex items-center gap-1">
        {order.customer_name || "Unknown"}
        <span className="text-[9px] opacity-70 font-normal ml-auto shrink-0 bg-white/20 px-1 rounded">rForce</span>
      </div>
      {order.account_name && (
        <div className="truncate opacity-80 text-[10px] leading-snug">{order.account_name}</div>
      )}
      {compact ? (
        city && <div className="truncate opacity-85 mt-0.5">{city}</div>
      ) : (
        <>
          <div className="flex items-center gap-1 mt-0.5 opacity-90">
            <MapPin size={10} />
            <span className="truncate">{order.address}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="opacity-80">
              {order.work_order_type || "Unknown"}
            </span>
            {order.product_count != null && order.product_count > 0 && (
              <span className="opacity-80">
                {order.product_count} units
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
