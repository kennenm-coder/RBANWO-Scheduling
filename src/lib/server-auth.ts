import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { SCHEDULING_ROLES } from "./auth";

/**
 * Server-side auth for this app's API routes.
 *
 * The browser keeps its Supabase session in localStorage (plain supabase-js,
 * no cookies), so a route handler can't read it from the request on its own.
 * The client sends the session's access token as `Authorization: Bearer <jwt>`
 * (see `authHeaders()` in src/lib/geocode.ts) and this verifies it with
 * Supabase, then checks the shared `allowed_emails` allowlist for a scheduling
 * role.
 *
 * Being signed in is deliberately NOT enough: the shared project allows
 * self-serve sign-up from a sibling app's login page, so "authenticated"
 * means "anyone on the internet" unless the roster is checked too.
 *
 * Same public URL + publishable key the browser uses — the data itself is
 * protected by RLS; this only gates our own server-side endpoints.
 */
const SUPA_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xusqjotoyntnfysquvlv.supabase.co";
const SUPA_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_HQigRx1Q8I6OpPffXMxRZQ_iqegVCka";

export interface AuthedUser {
  id: string;
  email: string;
  roles: string[];
}

type AuthResult =
  | { user: AuthedUser; error: null }
  | { user: null; error: NextResponse };

export async function requireSchedulingUser(req: Request): Promise<AuthResult> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return { user: null, error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }

  // A client carrying the user's JWT: auth.getUser() validates the token with
  // Supabase, and the allowlist read then runs as that user (RLS applies).
  const supabase = createClient(SUPA_URL, SUPA_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  if (!user?.email) {
    return { user: null, error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }

  const { data: row } = await supabase
    .from("allowed_emails")
    .select("role, roles")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();

  const roles: string[] = Array.isArray(row?.roles) && row.roles.length
    ? (row.roles as string[])
    : row?.role
      ? [row.role as string]
      : [];

  if (!row || !roles.some((r) => (SCHEDULING_ROLES as readonly string[]).includes(r))) {
    return {
      user: null,
      error: NextResponse.json({ error: "Not approved for the Scheduling app." }, { status: 403 }),
    };
  }

  return { user: { id: user.id, email: user.email, roles }, error: null };
}
