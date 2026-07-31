"use client";

import { useState, useEffect } from "react";
import { AppointmentEvent } from "@/lib/types";
import { fetchAppointmentEvents } from "@/lib/store";
import {
  Clock,
  ChevronDown,
  ChevronUp,
  Pencil,
  ArrowRightLeft,
  Trash2,
  RotateCcw,
  Plus,
  Link2,
  Flag,
  UserPlus,
  UserMinus,
} from "lucide-react";

const ACTION_LABELS: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  created: { label: "Created", icon: Plus, color: "text-green-600 dark:text-green-400" },
  updated: { label: "Edited", icon: Pencil, color: "text-blue-600 dark:text-blue-400" },
  rescheduled: { label: "Rescheduled", icon: ArrowRightLeft, color: "text-orange-600 dark:text-orange-400" },
  cancelled: { label: "Cancelled", icon: Trash2, color: "text-red-600 dark:text-red-400" },
  restored: { label: "Restored", icon: RotateCcw, color: "text-green-600 dark:text-green-400" },
  helper_added: { label: "Helper added", icon: UserPlus, color: "text-cyan-600 dark:text-cyan-400" },
  helper_removed: { label: "Helper removed", icon: UserMinus, color: "text-muted" },
  linked: { label: "Linked to rForce", icon: Link2, color: "text-purple-600 dark:text-purple-400" },
  flagged: { label: "Flagged", icon: Flag, color: "text-warning" },
};

interface Props {
  appointmentId: string;
}

export default function EventHistory({ appointmentId }: Props) {
  const [events, setEvents] = useState<AppointmentEvent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    fetchAppointmentEvents(appointmentId).then((e) => {
      setEvents(e);
      setLoading(false);
    });
  }, [appointmentId, expanded]);

  return (
    <div className="border-t border-border pt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground w-full"
      >
        <Clock size={12} />
        History
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-muted py-2">Loading...</div>
          ) : events.length === 0 ? (
            <div className="text-xs text-muted py-2">No history recorded yet</div>
          ) : (
            events.map((event) => {
              const info = ACTION_LABELS[event.action] || { label: event.action, icon: Clock, color: "text-muted" };
              const Icon = info.icon;
              return (
                <div key={event.id} className="flex items-start gap-2 text-xs">
                  <Icon size={12} className={`mt-0.5 shrink-0 ${info.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-medium ${info.color}`}>{info.label}</span>
                      {event.actor_name_snapshot && (
                        <span className="text-muted">by {event.actor_name_snapshot}</span>
                      )}
                    </div>
                    {event.reason && (
                      <div className="text-muted mt-0.5">{event.reason}</div>
                    )}
                    <div className="text-muted/60 mt-0.5">
                      {new Date(event.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
