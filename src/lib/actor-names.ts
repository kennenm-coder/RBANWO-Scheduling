import { getSupabase } from "./supabase";

/**
 * Resolve auth user ids → human-readable names.
 *
 * `sched_appointments.scheduled_by` (and event `actor_id`) store the auth.users
 * uuid. Nothing in this app writes `sched_profiles` rows yet, so a profile may
 * not exist. Resolution order:
 *   1. sched_profiles.display_name (readable by every allowlisted user)
 *   2. newest sched_appointment_events.actor_name_snapshot for that actor
 *      (every scheduling write logs one, so anyone who has ever scheduled
 *      something is resolvable)
 *
 * Results are cached per session — names change rarely and the sheet opens
 * often.
 */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export function cachedActorName(userId: string): string | null | undefined {
  return cache.get(userId);
}

export async function resolveActorName(userId: string): Promise<string | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null;
  const pending = inflight.get(userId);
  if (pending) return pending;

  const p = (async () => {
    const sb = getSupabase();
    if (!sb) return null;

    const { data: prof } = await sb
      .from("sched_profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (prof?.display_name) return prof.display_name as string;

    const { data: ev } = await sb
      .from("sched_appointment_events")
      .select("actor_name_snapshot")
      .eq("actor_id", userId)
      .not("actor_name_snapshot", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (ev?.actor_name_snapshot as string | null) ?? null;
  })()
    .catch(() => null)
    .then((name) => {
      cache.set(userId, name);
      inflight.delete(userId);
      return name;
    });

  inflight.set(userId, p);
  return p;
}

/** Short, stable fallback when no name is known: first uuid segment. */
export function shortActorId(userId: string): string {
  return userId.split("-")[0];
}
