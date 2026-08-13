"use client";

import { useAuth } from "./AuthProvider";
import { Loader2 } from "lucide-react";

/**
 * Soft auth gate — shows a loading spinner while the session initialises,
 * then always renders children regardless of auth state.
 *
 * Auth enforcement will be added later when the calendar app's login
 * system is integrated into this app.
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();

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

  return <>{children}</>;
}
