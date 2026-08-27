"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
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

  // Latest status/user id readable from inside resolve() without re-creating it.
  // onAuthStateChange fires repeatedly for a long-open tab (token refreshes), so
  // resolve() must be able to see the *current* session and refuse to tear it
  // down over a benign event.
  const statusRef = useRef<AuthStatus>("loading");
  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const resolve = useCallback(async (event: string, u: User | null) => {
    // Same user, already authed → this is a token refresh, not a re-login.
    // Keep the fresh user object but skip the network re-gate entirely. This is
    // the fix for tiles vanishing on a stale tab: a routine refresh must never
    // be able to flip access off (which would unmount the whole calendar).
    if (u && u.id === userIdRef.current && statusRef.current === "authed") {
      setUser(u);
      return;
    }

    // supabase can emit a momentarily-null session during token rotation. Unless
    // it's an explicit sign-out, don't knock a good session to the login screen.
    if (!u && event !== "SIGNED_OUT" && event !== "INITIAL_SESSION" && statusRef.current === "authed") {
      return;
    }

    setUser(u);
    userIdRef.current = u?.id ?? null;

    if (!u?.email) {
      setProfile(null);
      setRoles([]);
      setAllowName(null);
      setStatus("unauthed");
      return;
    }

    // Duck Force allowlist is the access gate; sched_profiles is optional display.
    let allow: Awaited<ReturnType<typeof fetchAllowlist>>;
    let prof: UserProfile | null;
    try {
      [allow, prof] = await Promise.all([
        fetchAllowlist(u.email),
        fetchProfile(u.id).catch(() => null),
      ]);
    } catch {
      // The allowlist re-check itself failed (e.g. network blip on wake).
      // Preserve whatever access we already had instead of falsely dropping to
      // "not-allowed" and unmounting the app. If we weren't authed yet, fall
      // back to unauthed so the login flow can retry.
      if (statusRef.current === "authed") return;
      setStatus("unauthed");
      return;
    }

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
    sb.auth.getSession().then(({ data }) => resolve("INITIAL_SESSION", data.session?.user ?? null));
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) =>
      resolve(event, session?.user ?? null)
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
