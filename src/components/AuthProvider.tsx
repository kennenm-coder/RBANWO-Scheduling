"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { fetchProfile, type UserProfile, type UserRole } from "@/lib/auth";
import type { User } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  displayName: string;
  role: UserRole;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  loading: true,
  displayName: "Unknown",
  role: "scheduler",
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }

    sb.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      if (u) {
        fetchProfile(u.id).then((p) => {
          setProfile(p);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        fetchProfile(u.id).then(setProfile);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = useCallback(async () => {
    const sb = getSupabase();
    if (sb) await sb.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const displayName = profile?.display_name || user?.email?.split("@")[0] || "Unknown";
  const role = profile?.role || "scheduler";

  return (
    <AuthContext.Provider value={{ user, profile, loading, displayName, role, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}
