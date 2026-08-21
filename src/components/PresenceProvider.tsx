"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { useAuth } from "./AuthProvider";
import { presenceColorForUser } from "@/lib/preferences";
import { getWeekDays } from "@/lib/calendar-utils";
import { PresenceContext, usePresenceChannel, type PresenceIdentity } from "@/lib/presence";
import type { ViewMode } from "@/lib/types";

/** Stable per-tab id for the localhost dev bypass (no real session), so two
 *  local tabs can still demo presence. */
function devTabId(): string {
  if (typeof window === "undefined") return "dev";
  const KEY = "rbanwo-presence-dev-id";
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = "dev-" + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

export default function PresenceProvider({
  viewMode,
  currentDate,
  children,
}: {
  viewMode: ViewMode;
  currentDate: Date;
  children: React.ReactNode;
}) {
  const { user, displayName, hasAccess, devBypass } = useAuth();

  const identity: PresenceIdentity | null = useMemo(() => {
    if (!hasAccess) return null;
    const userId = user?.id || (devBypass ? devTabId() : null);
    if (!userId) return null;
    const dateKeys =
      viewMode === "day"
        ? [format(currentDate, "yyyy-MM-dd")]
        : getWeekDays(currentDate).map((d) => format(d, "yyyy-MM-dd"));
    return {
      userId,
      name: displayName,
      color: presenceColorForUser(userId),
      view: viewMode,
      dateKeys,
    };
  }, [user?.id, hasAccess, devBypass, displayName, viewMode, currentDate]);

  const value = usePresenceChannel(identity);

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}
