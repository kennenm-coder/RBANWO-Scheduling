"use client";

import type { Appointment } from "@/lib/types";
import { useJobLinks } from "./JobLinksProvider";

/**
 * Install-paperwork chips for a scheduled tile: material list, legacy link, or
 * (service tiles) active write-ups.
 *
 * Display only, and inline: it renders inside an existing row so a tile never
 * grows. Dark translucent pills with white text read on every crew colour.
 * Renders nothing until the data lands, or when there is nothing to show.
 *
 * Named "Mat List" rather than "Linked" because "Linked" already means
 * linked-to-rForce on these tiles.
 */
export default function JobLinkChips({
  appointment,
  size = "sm",
  className = "",
}: {
  appointment: Pick<Appointment, "appointment_type" | "order_number" | "address">;
  /** "xs" = abbreviations for narrow tiles; "sm" = labelled. */
  size?: "xs" | "sm";
  className?: string;
}) {
  const links = useJobLinks(appointment);
  const xs = size === "xs";
  const base = `${className} shrink-0 rounded bg-black/30 text-white font-semibold leading-none ${
    xs ? "px-0.5 py-px text-[7px]" : "px-1 py-0.5 text-[9px]"
  }`;

  if (links.installDocUrl) {
    return (
      <span className={base} title="Material list attached — install instructions available">
        {xs ? "ML" : "Mat List"}
      </span>
    );
  }
  if (links.legacyUrl) {
    return (
      <span className={base} title="Legacy install instructions linked (no material list yet)">
        {xs ? "LEG" : "Legacy"}
      </span>
    );
  }
  if (links.writeUpCount > 0) {
    return (
      <span
        className={`${base} !bg-amber-500`}
        title={`${links.writeUpCount} active write-up${links.writeUpCount === 1 ? "" : "s"} at this address`}
      >
        {xs ? `WU${links.writeUpCount}` : `Write-Ups ${links.writeUpCount}`}
      </span>
    );
  }
  return null;
}
