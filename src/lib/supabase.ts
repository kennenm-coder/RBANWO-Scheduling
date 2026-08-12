import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPA_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://xusqjotoyntnfysquvlv.supabase.co";
const SUPA_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_HQigRx1Q8I6OpPffXMxRZQ_iqegVCka";

let _client: SupabaseClient | null = null;
let _warnedOnce = false;

export function getSupabase(): SupabaseClient | null {
  if (_client) return _client;
  try {
    _client = createClient(SUPA_URL, SUPA_KEY);
    return _client;
  } catch {
    if (!_warnedOnce) {
      console.warn("[supabase] Failed to create client — all store operations will return empty results");
      _warnedOnce = true;
    }
    return null;
  }
}

/**
 * Like getSupabase() but throws instead of returning null.
 * Use for write operations where a missing DB connection is a real error,
 * not a graceful degradation scenario.
 */
export function requireSupabase(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) throw new Error("No database connection");
  return sb;
}
