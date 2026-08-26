"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { usePresence } from "@/lib/presence";
import { getWeekDays } from "@/lib/calendar-utils";
import type { ViewMode } from "@/lib/types";

/** Initials from a display name. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * "Who's here" avatars — shows peers whose viewed days intersect the current
 * view. Purely informational; no interactivity that affects scheduling.
 */
export default function PresenceAvatars({
  viewMode,
  currentDate,
}: {
  viewMode: ViewMode;
  currentDate: Date;
}) {
  const { peers } = usePresence();

  const myDateKeys = useMemo(
    () =>
      new Set(
        viewMode === "day"
          ? [format(currentDate, "yyyy-MM-dd")]
          : getWeekDays(currentDate).map((d) => format(d, "yyyy-MM-dd"))
      ),
    [viewMode, currentDate]
  );

  const visible = useMemo(
    () => peers.filter((p) => p.dateKeys.some((k) => myDateKeys.has(k))),
    [peers, myDateKeys]
  );

  if (visible.length === 0) return null;

  const shown = visible.slice(0, 5);
  const extra = visible.length - shown.length;

  return (
    <div className="flex items-center -space-x-1.5" aria-label={`${visible.length} others viewing`}>
      {shown.map((p) => {
        // When a peer is focused on a single day inside my week, hint which one.
        const dayHint =
          p.view === "day" && p.dateKeys[0]
            ? ` · on ${format(parseISO(p.dateKeys[0]), "EEE")}`
            : "";
        return (
          <div
            key={p.userId}
            title={`${p.name} — ${p.view} view${dayHint}`}
            className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ring-2 ring-background"
            style={{ backgroundColor: p.color }}
          >
            {initials(p.name)}
          </div>
        );
      })}
      {extra > 0 && (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold bg-surface text-muted ring-2 ring-background border border-border"
          title={`${extra} more`}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}
