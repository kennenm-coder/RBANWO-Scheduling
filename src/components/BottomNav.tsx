"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { CalendarDays, ListTodo, Users, Settings, AlertTriangle } from "lucide-react";
import { useData } from "./DataProvider";
import { findUnmatchedNames } from "@/lib/unmatched-resources";
import { detectFlags } from "@/lib/flags";

const NAV_ITEMS = [
  { href: "/", label: "Calendar", icon: CalendarDays },
  { href: "/queue", label: "Queue", icon: ListTodo },
  { href: "/issues", label: "Issues", icon: AlertTriangle },
  { href: "/resources", label: "Resources", icon: Users },
  { href: "/admin", label: "Admin", icon: Settings },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { crews, appointments, rforceOrders, timeOffRequests, activeLinks, flagResolutions } = useData();

  const unmatchedCount = useMemo(
    () => findUnmatchedNames(crews, rforceOrders, timeOffRequests).length,
    [crews, rforceOrders, timeOffRequests]
  );

  const flagCount = useMemo(() => {
    const allFlags = detectFlags(appointments, crews, rforceOrders, timeOffRequests, activeLinks);
    const resolvedKeys = new Set(flagResolutions.map((r) => r.flag_key));
    // Count only actionable flags (open state, not info severity)
    const withState = allFlags.map((f) => {
      if (f.autoClears) return f;
      if (resolvedKeys.has(f.id)) return { ...f, state: "waiting_for_import" as const };
      return f;
    });
    return withState.filter((f) => f.state === "open" && f.severity !== "info").length;
  }, [appointments, crews, rforceOrders, timeOffRequests, activeLinks, flagResolutions]);

  return (
    <nav className="sticky bottom-0 z-40 bg-background border-t border-border safe-area-bottom">
      <div className="flex">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          const badge =
            href === "/resources" && unmatchedCount > 0
              ? unmatchedCount
              : href === "/issues" && flagCount > 0
                ? flagCount
                : 0;
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-xs font-medium transition-colors relative ${
                active
                  ? "text-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <div className="relative">
                <Icon size={20} />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full leading-none">
                    {badge}
                  </span>
                )}
              </div>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
