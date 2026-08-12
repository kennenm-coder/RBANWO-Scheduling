/**
 * Work-order type color palette for queue cards and badges.
 * These colors apply ONLY to the queue — calendar cards continue using crew colors.
 */

export interface WoTypeColor {
  label: string;
  /** Tailwind border-left color class */
  border: string;
  /** Tailwind badge background */
  bg: string;
  /** Tailwind badge text */
  text: string;
  /** Hex for any programmatic use */
  hex: string;
}

export const WO_TYPE_COLORS: Record<string, WoTypeColor> = {
  tech_measure: {
    label: "Tech Measure",
    border: "border-l-amber-500",
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-800 dark:text-amber-200",
    hex: "#f59e0b",
  },
  install: {
    label: "Install",
    border: "border-l-blue-500",
    bg: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-800 dark:text-blue-200",
    hex: "#3b82f6",
  },
  service: {
    label: "Service",
    border: "border-l-rose-500",
    bg: "bg-rose-100 dark:bg-rose-900/30",
    text: "text-rose-800 dark:text-rose-200",
    hex: "#f43f5e",
  },
  jip: {
    label: "JIP",
    border: "border-l-purple-500",
    bg: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-800 dark:text-purple-200",
    hex: "#a855f7",
  },
  lswp: {
    label: "LSWP",
    border: "border-l-orange-500",
    bg: "bg-orange-100 dark:bg-orange-900/30",
    text: "text-orange-800 dark:text-orange-200",
    hex: "#f97316",
  },
  hoa: {
    label: "HOA",
    border: "border-l-teal-500",
    bg: "bg-teal-100 dark:bg-teal-900/30",
    text: "text-teal-800 dark:text-teal-200",
    hex: "#14b8a6",
  },
  paint_stain: {
    label: "Paint/Stain",
    border: "border-l-pink-500",
    bg: "bg-pink-100 dark:bg-pink-900/30",
    text: "text-pink-800 dark:text-pink-200",
    hex: "#ec4899",
  },
  unknown: {
    label: "Unknown",
    border: "border-l-gray-400",
    bg: "bg-gray-100 dark:bg-gray-800/50",
    text: "text-gray-600 dark:text-gray-300",
    hex: "#9ca3af",
  },
};

import { normalizeWoTypeOrUnknown } from "./normalize";

/**
 * Normalize raw rForce work_order_type strings into our AppointmentType values.
 * Returns the AppointmentType key or "unknown" for unrecognized values.
 *
 * Delegates to the centralized normalize module. This re-export maintains
 * backward compatibility for existing imports.
 */
export function normalizeWoType(raw: string | null | undefined): string {
  return normalizeWoTypeOrUnknown(raw);
}

export function getWoTypeColor(normalizedType: string): WoTypeColor {
  return WO_TYPE_COLORS[normalizedType] || WO_TYPE_COLORS.unknown;
}

/**
 * Get unique WO types present in a dataset.
 * Returns [{value, label, count}] sorted by count descending.
 */
export function getAvailableWoTypes(
  items: { normalizedWoType: string }[]
): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const t = item.normalizedWoType || "unknown";
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      label: (WO_TYPE_COLORS[value] || WO_TYPE_COLORS.unknown).label,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}
