"use client";

import { useAuth } from "./AuthProvider";
import { Loader2 } from "lucide-react";

/**
 * Soft auth gate — shows a loading spinner while the session initialises,
 * then always renders children regardless of auth state.
 *
 * When we're ready to enforce login, flip ENFORCE_AUTH to true (or replace
 * this component with the hard-gate version that redirects to /login).
 */
const ENFORCE_AUTH = false;

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();

  // Still loading the session — brief spinner so the UI doesn't flash
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="text-sm text-muted">Loading...</span>
        </div>
      </div>
    );
  }

  // Soft gate: always render children (auth enforcement is off for now)
  if (!ENFORCE_AUTH) return <>{children}</>;

  // Hard gate path (currently unreachable) — left for future activation
  return <>{children}</>;
}
