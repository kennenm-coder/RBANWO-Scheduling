"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { CalendarDays, ListTodo, Users, Settings, AlertTriangle } from "lucide-react";
import { useData } from "./DataProvider";
import { categorizeResourceNames, deniedNamesFromFlagKeys } from "@/lib/unmatched-resources";
import { deriveIssues, deriveDroppedTiles } from "@/lib/issues";

const NAV_ITEMS = [
  { href: "/", label: "Calendar", icon: CalendarDays },
  { href: "/issues", label: "Issues", icon: AlertTriangle },
  { href: "/queue", label: "Queue", icon: ListTodo },
  { href: "/resources", label: "Resources", icon: Users },
  { href: "/admin", label: "Admin", icon: Settings },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { crews, rforceOrders, appointments, activeLinks, resourceMappings, timeOffRequests, flagResolutions, scheduledWorkOrders, dismissals } = useData();

  // Resources badge = names needing attention: hard-unmatched + close-enough
  // suggestions awaiting confirm/deny.
  const unmatchedCount = useMemo(() => {
    const denied = deniedNamesFromFlagKeys(flagResolutions.map((f) => f.flag_key));
    const { unmatched, suggested } = categorizeResourceNames(
      crews,
      rforceOrders,
      timeOffRequests,
      denied
    );
    return unmatched.length + suggested.length;
  }, [crews, rforceOrders, timeOffRequests, flagResolutions]);

  // Pass scheduledWorkOrders so the badge counts issues the same way the Issues
  // page does — otherwise already-scheduled jobs get re-flagged as "missing".
  const issueCount = useMemo(
    () =>
      deriveIssues(rforceOrders, appointments, activeLinks, crews, resourceMappings, scheduledWorkOrders, dismissals).length +
      deriveDroppedTiles(appointments, rforceOrders, dismissals).length,
    [rforceOrders, appointments, activeLinks, crews, resourceMappings, scheduledWorkOrders, dismissals]
  );

  return (
    <nav className="sticky bottom-0 z-40 bg-background border-t border-border safe-area-bottom">
      <div className="flex">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          const badge =
            href === "/resources" && unmatchedCount > 0
              ? unmatchedCount
              : href === "/issues" && issueCount > 0
                ? issueCount
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
