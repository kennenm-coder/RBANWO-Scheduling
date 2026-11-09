"use client";

import { Building2, GripVertical, ShieldAlert } from "lucide-react";
import { useSchedulerDrag } from "@/lib/drag-context";
import type { SpecialAssignmentKind } from "@/lib/availability";

/**
 * Special Assignments: two drag-only tiles above the queue's job tiles. Drop one
 * on a crew's day to block that crew for the whole day (Special Ops = weather /
 * standby crew, Office Day = in the office). Manager and admin only — the caller
 * gates on role.
 *
 * The block is a normal full-day availability rule, so a scheduler can still
 * book a job over it with the usual "this day is blocked" override.
 */
const TILES: {
  kind: SpecialAssignmentKind;
  label: string;
  hint: string;
  accent: string;
  Icon: typeof ShieldAlert;
}[] = [
  { kind: "special_ops", label: "Special Ops", hint: "Weather / standby crew", accent: "var(--blk-special)", Icon: ShieldAlert },
  { kind: "office_day", label: "Office Day", hint: "Crew works from the office", accent: "var(--blk-office)", Icon: Building2 },
];

export default function SpecialAssignmentStrip() {
  const { setDraggedSpecial, clearDrag } = useSchedulerDrag();

  return (
    <div className="px-3 py-2 border-b border-border bg-surface/40" data-testid="special-assignments">
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Special assignments</span>
        <span className="text-[9px] text-muted/70">drag onto a crew&apos;s day</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {TILES.map(({ kind, label, hint, accent, Icon }) => (
          <div
            key={kind}
            draggable
            title={`Drag onto a crew's day to block it as ${label}`}
            onDragStart={(e) => {
              setDraggedSpecial(kind);
              e.dataTransfer.effectAllowed = "copy";
              e.dataTransfer.setData("text/plain", kind);
            }}
            onDragEnd={() => clearDrag()}
            className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-shadow"
            style={{ borderColor: accent, borderLeftWidth: 3 }}
          >
            <GripVertical size={12} className="text-muted/40 shrink-0" />
            <Icon size={14} className="shrink-0" style={{ color: accent }} />
            <div className="min-w-0">
              <div className="text-xs font-semibold leading-tight" style={{ color: accent }}>{label}</div>
              <div className="text-[9px] text-muted leading-tight truncate">{hint}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
