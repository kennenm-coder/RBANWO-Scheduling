import { useEffect, useState } from "react";
import { cachedActorName, resolveActorName, shortActorId } from "@/lib/actor-names";

/**
 * Human-readable label for an auth user id (see actor-names.ts).
 * Returns the cached name synchronously when available, resolves otherwise,
 * and falls back to a short id fragment so the UI never shows a full uuid.
 */
export function useActorName(userId: string | null | undefined): string | null {
  const [name, setName] = useState<string | null>(() =>
    userId ? cachedActorName(userId) ?? null : null
  );

  useEffect(() => {
    if (!userId) {
      setName(null);
      return;
    }
    const cached = cachedActorName(userId);
    if (cached !== undefined) {
      setName(cached);
      return;
    }
    let alive = true;
    resolveActorName(userId).then((n) => {
      if (alive) setName(n);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  if (!userId) return null;
  return name ?? shortActorId(userId);
}
