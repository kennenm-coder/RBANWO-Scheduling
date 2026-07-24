import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPA_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://xusqjotoyntnfysquvlv.supabase.co";
const SUPA_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_HQigRx1Q8I6OpPffXMxRZQ_iqegVCka";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (_client) return _client;
  try {
    _client = createClient(SUPA_URL, SUPA_KEY);
    return _client;
  } catch {
    return null;
  }
}
