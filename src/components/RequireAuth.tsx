"use client";

import { useAuth } from "./AuthProvider";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user && pathname !== "/login") {
      router.replace("/login");
    }
  }, [loading, user, pathname, router]);

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

  // Not logged in and not on login page — show nothing while redirect happens
  if (!user && pathname !== "/login") {
    return null;
  }

  return <>{children}</>;
}
