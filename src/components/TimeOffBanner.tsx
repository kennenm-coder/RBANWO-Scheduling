"use client";

import { TimeOffRequest } from "@/lib/types";
import { getTimeOffForDate } from "@/lib/store";
import { format } from "date-fns";
import { useMemo } from "react";
import { Palmtree } from "lucide-react";

export default function TimeOffBanner({
  requests,
  date,
}: {
  requests: TimeOffRequest[];
  date: Date;
}) {
  const dateStr = format(date, "yyyy-MM-dd");
  const offToday = useMemo(
    () => getTimeOffForDate(requests, dateStr),
    [requests, dateStr]
  );

  if (offToday.length === 0) return null;

  return (
    <div className="bg-rba-green text-white px-3 py-1.5 flex items-center gap-2 overflow-x-auto">
      <Palmtree className="w-4 h-4 shrink-0 opacity-80" />
      <span className="text-xs font-medium shrink-0">Off:</span>
      <div className="flex gap-1.5 text-xs">
        {offToday.map((r) => (
          <span
            key={r.id}
            className="bg-white/20 rounded-full px-2 py-0.5 whitespace-nowrap"
          >
            {r.employee_name}
          </span>
        ))}
      </div>
    </div>
  );
}
