import { getSupabase } from "./supabase";
import { Appointment } from "./types";
import type { RealtimeChannel } from "@supabase/supabase-js";

type ChangeHandler = (
  event: "INSERT" | "UPDATE" | "DELETE",
  appointment: Appointment
) => void;

let channel: RealtimeChannel | null = null;

export function subscribeToAppointments(
  onChange: ChangeHandler
): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};

  channel = sb
    .channel("sched-appointments")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "sched_appointments",
      },
      (payload) => {
        const event = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const record =
          event === "DELETE"
            ? ((payload as any).old_record as Appointment)
            : (payload.new as Appointment);
        if (record) {
          onChange(event, record);
        }
      }
    )
    .subscribe();

  return () => {
    if (channel) {
      sb.removeChannel(channel);
      channel = null;
    }
  };
}
