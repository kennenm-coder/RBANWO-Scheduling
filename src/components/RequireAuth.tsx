"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { Loader2 } from "lucide-react";

/** Public routes that don't require authentication. */
const PUBLIC_PATHS = new Set(["/login"]);

/**
 * Wraps children with an auth gate.
 * - While loading the session: shows a spinner
 * - If not authenticated: redirects to /login
 * - If authenticated: renders children
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (!loading && !user && !isPublic) {
      router.replace("/login");
    }
  }, [loading, user, isPublic, router]);

  // Already on a public page — always render
  if (isPublic) return <>{children}</>;

  // Still loading — show spinner
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

  // Not authenticated — render nothing while redirect fires
  if (!user) return null;

  return <>{children}</>;
}
