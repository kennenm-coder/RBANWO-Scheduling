"use client";

import { X } from "lucide-react";
import { useData } from "./DataProvider";
import { useAuth } from "./AuthProvider";
import { canManage } from "@/lib/auth";
import { isOneDaySpecialRule } from "@/lib/availability";

/**
 * Small "x" on a blocked day that clears a one-day Special Ops / Office tile.
 * Renders nothing for anyone below manager, or when the block came from
 * somewhere else (PTO, a weekly Office Day, a company holiday).
 */
export default function SpecialDayRemove({ ruleId }: { ruleId?: string }) {
  const { availabilityRules, removeSpecialDay } = useData();
  const { role } = useAuth();
  if (!ruleId || !canManage(role)) return null;
  const rule = availabilityRules.find((r) => r.id === ruleId);
  if (!isOneDaySpecialRule(rule)) return null;
  return (
    <button
      type="button"
      title="Remove this assignment"
      aria-label="Remove this assignment"
      onClick={(e) => {
        e.stopPropagation();
        void removeSpecialDay(ruleId);
      }}
      className="ml-1 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 shrink-0"
    >
      <X size={10} />
    </button>
  );
}
