"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  fetchProfile,
  fetchAllowlist,
  hasSchedulingAccess,
  mapSchedulingRole,
  isDevBypass,
  type UserProfile,
  type UserRole,
} from "@/lib/auth";
import { setPreferencesUser, loadPreferencesFromSupabase } from "@/lib/preferences";
import type { User } from "@supabase/supabase-js";

/**
 * loading     — still resolving the session/allowlist
 * authed      — signed in AND holds a scheduling role (or dev bypass)
 * unauthed    — no session (show login)
 * not-allowed — signed in but no scheduling role on the Duck Force allowlist
 */
export type AuthStatus = "loading" | "authed" | "unauthed" | "not-allowed";

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  status: AuthStatus;
  /** Full Duck Force role set for this user. */
  roles: string[];
  /** True when the user may use the scheduling app. */
  hasAccess: boolean;
  displayName: string;
  role: UserRole;
  /** True when running under the localhost dev bypass. */
  devBypass: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  loading: true,
  status: "loading",
  roles: [],
  hasAccess: false,
  displayName: "Unknown",
  role: "scheduler",
  devBypass: false,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

/** Shortcut for audit trail: returns actor_id and actor_name_snapshot for events. */
export function useCurrentActor() {
  const { user, displayName } = useAuth();
  return {
    actorId: user?.id ?? null,
    actorName: user ? displayName : null,
  };
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [allowName, setAllowName] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const dev = typeof window !== "undefined" ? isDevBypass() : false;

  const resolve = useCallback(async (u: User | null) => {
    setUser(u);
    if (!u?.email) {
      setProfile(null);
      setRoles([]);
      setAllowName(null);
      setStatus("unauthed");
      return;
    }
    // Duck Force allowlist is the access gate; sched_profiles is optional display.
    const [allow, prof] = await Promise.all([
      fetchAllowlist(u.email),
      fetchProfile(u.id).catch(() => null),
    ]);
    const roleSet = allow?.roles ?? [];
    setProfile(prof);
    setRoles(roleSet);
    setAllowName(allow?.name ?? null);
    const allowed = hasSchedulingAccess(roleSet);
    setStatus(allowed ? "authed" : "not-allowed");
    if (allowed) {
      // Per-user preference sync: load cloud prefs, then register for push.
      setPreferencesUser(u.id);
      void loadPreferencesFromSupabase(u.id);
    }
  }, []);

  useEffect(() => {
    if (dev) {
      // Local demo mode — never hit the network gate.
      setStatus("authed");
      setRoles(["admin"]);
      return;
    }
    const sb = getSupabase();
    if (!sb) {
      setStatus("unauthed");
      return;
    }
    sb.auth.getSession().then(({ data }) => resolve(data.session?.user ?? null));
    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, session) =>
      resolve(session?.user ?? null)
    );
    return () => subscription.unsubscribe();
  }, [dev, resolve]);

  const handleSignOut = useCallback(async () => {
    const sb = getSupabase();
    if (sb) await sb.auth.signOut();
    setPreferencesUser(null);
    setUser(null);
    setProfile(null);
    setRoles([]);
    setStatus("unauthed");
  }, []);

  const loading = status === "loading";
  const hasAccess = dev || status === "authed";
  const role: UserRole = dev
    ? "admin"
    : profile?.role || mapSchedulingRole(roles);
  const displayName =
    profile?.display_name ||
    allowName ||
    user?.email?.split("@")[0] ||
    (dev ? "Local Dev" : "Unknown");

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        status,
        roles,
        hasAccess,
        displayName,
        role,
        devBypass: dev,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
