"use client";

import { RForceOrder, Crew } from "@/lib/types";
import { typeLabel, typeColor } from "@/lib/calendar-utils";
import { openSalesforce } from "@/lib/salesforce";
import { MapPin, ExternalLink } from "lucide-react";

interface Props {
  order: RForceOrder;
  crew?: Crew;
  compact?: boolean;
  onClick?: () => void;
}

function woTypeToApptType(woType: string | null): string {
  if (!woType) return "install";
  const lower = woType.toLowerCase();
  if (lower.includes("tech measure")) return "tech_measure";
  if (lower.includes("install")) return "install";
  if (lower.includes("service")) return "service";
  if (lower.includes("job site") || lower.includes("jip")) return "jip";
  if (lower.includes("hoa")) return "hoa";
  return "install";
}

export default function RForceCard({ order, crew, compact, onClick }: Props) {
  const borderColor = crew?.color || "#888";

  return (
    <div
      onClick={onClick}
      className="rounded-lg p-2 cursor-pointer hover:shadow-md transition-shadow text-xs leading-tight overflow-hidden border-2 border-dashed bg-background"
      style={{ borderColor }}
    >
      <div className="font-semibold truncate flex items-center gap-1" style={{ color: borderColor }}>
        {order.customer_name || "Unknown"}
        <span className="text-[9px] opacity-60 font-normal ml-auto shrink-0">rForce</span>
      </div>
      {!compact && (
        <>
          <div className="flex items-center gap-1 mt-0.5 text-muted">
            <MapPin size={10} />
            <span className="truncate">{order.address}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-muted">
              {order.work_order_type || "Unknown"}
            </span>
            {order.product_count != null && order.product_count > 0 && (
              <span className="text-muted">
                {order.product_count} units
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
