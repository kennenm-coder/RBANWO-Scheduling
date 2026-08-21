"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { Loader2, ShieldX, LogOut } from "lucide-react";

function Spinner() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={24} className="animate-spin text-primary" />
        <span className="text-sm text-muted">Loading…</span>
      </div>
    </div>
  );
}

/**
 * Hard auth gate. Accounts come from the Duck Force calendar app (shared
 * Supabase project); only users holding a scheduling role may enter.
 *
 * - loading      → spinner
 * - authed / dev → render the app
 * - unauthed     → let the /login route render; redirect everything else there
 * - not-allowed  → "no scheduling access" screen with a sign-out link
 *
 * Localhost keeps a dev bypass (see isDevBypass) so local demos never hit the
 * wall; append ?forceLogin=1 on localhost to preview the real login flow.
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, hasAccess, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === "/login";

  // The auth decision depends on client-only state (session + localhost dev
  // bypass). Render the server-matched spinner until mounted to avoid a
  // hydration mismatch, then apply the real gate.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && status === "unauthed" && !onLogin) router.replace("/login");
  }, [mounted, status, onLogin, router]);

  if (!mounted) return <Spinner />;

  if (hasAccess) return <>{children}</>;

  if (status === "loading") return <Spinner />;

  if (status === "not-allowed") {
    return (
      <div className="flex-1 flex items-center justify-center p-6 min-h-[60vh]">
        <div className="w-full max-w-sm text-center space-y-4">
          <ShieldX size={40} className="mx-auto text-muted" />
          <div>
            <p className="font-medium">No scheduling access</p>
            <p className="text-sm text-muted mt-1">
              Your Duck Force account isn&apos;t approved for the Scheduling app yet.
              Ask an admin to add a <strong>Scheduling</strong> role to your account.
            </p>
          </div>
          <button
            onClick={() => signOut()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/20 transition-colors"
          >
            <LogOut size={15} />
            Sign out and use a different account
          </button>
        </div>
      </div>
    );
  }

  // unauthed: render the login page itself, otherwise show a spinner while the
  // redirect effect above navigates to /login.
  if (onLogin) return <>{children}</>;
  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <Loader2 size={24} className="animate-spin text-primary" />
    </div>
  );
}
