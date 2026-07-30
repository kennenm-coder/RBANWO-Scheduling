import { getSupabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

export type UserRole = "scheduler" | "manager" | "admin" | "read_only";

export interface UserProfile {
  id: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
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
