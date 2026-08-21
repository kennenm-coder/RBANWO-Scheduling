import { getSupabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

export type UserRole = "scheduler" | "manager" | "admin" | "read_only";

export interface UserProfile {
  id: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
}

// ─── Shared Duck Force allowlist ────────────────────────────────────────────
// Accounts live in the Duck Force calendar app on the same Supabase project.
// Only these roles (from allowed_emails.roles) may use the scheduling app.
export const SCHEDULING_ROLES = ["admin", "scheduling", "scheduling_manager"] as const;

export interface Allowlist {
  role: string | null;
  roles: string[];
  name: string | null;
}

/** Read the current user's Duck Force allowlist row (self-read RLS allows this). */
export async function fetchAllowlist(email: string): Promise<Allowlist | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("allowed_emails")
    .select("role, roles, name")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (!data) return null;
  const roles = Array.isArray(data.roles) && data.roles.length
    ? (data.roles as string[])
    : data.role
      ? [data.role as string]
      : [];
  return { role: (data.role as string) ?? null, roles, name: (data.name as string) ?? null };
}

/** Does this role set grant access to the scheduling app? */
export function hasSchedulingAccess(roles: string[]): boolean {
  return roles.some((r) => (SCHEDULING_ROLES as readonly string[]).includes(r));
}

/** Map Duck Force allowlist roles → this app's permission role (highest wins). */
export function mapSchedulingRole(roles: string[]): UserRole {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("scheduling_manager")) return "manager";
  if (roles.includes("scheduling")) return "scheduler";
  return "read_only";
}

/**
 * Localhost dev bypass — skip the login wall for local demos/editing.
 *
 * `?forceLogin=1` (localhost only) disables the bypass so the real login screen
 * can be tested locally. The flag is made STICKY for the browser session so it
 * survives the redirect to /login (which drops the query string); `?forceLogin=0`
 * clears it. In production the hostname is never localhost, so the bypass is
 * always off there and the param is irrelevant.
 */
const FORCE_LOGIN_KEY = "rbanwo-force-login";
export function isDevBypass(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  const isLocal = h === "localhost" || h === "127.0.0.1" || h.endsWith(".local");
  if (!isLocal) return false;

  const param = new URLSearchParams(window.location.search).get("forceLogin");
  try {
    if (param === "1") sessionStorage.setItem(FORCE_LOGIN_KEY, "1");
    else if (param === "0") sessionStorage.removeItem(FORCE_LOGIN_KEY);
    if (sessionStorage.getItem(FORCE_LOGIN_KEY) === "1") return false;
  } catch {
    // sessionStorage unavailable — fall back to the raw param.
    if (param === "1") return false;
  }
  return true;
}

export async function signIn(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) throw new Error("No Supabase client");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function getUser(): Promise<User | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user;
}

export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("sched_profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data as UserProfile | null;
}

export function canEdit(role: UserRole): boolean {
  return role === "scheduler" || role === "manager" || role === "admin";
}

export function canManage(role: UserRole): boolean {
  return role === "manager" || role === "admin";
}

export function canAdmin(role: UserRole): boolean {
  return role === "admin";
}
