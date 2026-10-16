"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { CalendarDays, ListTodo, Users, AlertTriangle, Gauge } from "lucide-react";
import { useData } from "./DataProvider";
import { useAuth } from "./AuthProvider";
import { canManage } from "@/lib/auth";
import { categorizeResourceNames, deniedNamesFromFlagKeys } from "@/lib/unmatched-resources";
import { deriveIssues, deriveDroppedTiles, deriveAwaitingRForce, countIssues } from "@/lib/issues";

const NAV_ITEMS = [
  { href: "/", label: "Calendar", icon: CalendarDays },
  { href: "/issues", label: "Issues", icon: AlertTriangle },
  { href: "/queue", label: "Queue", icon: ListTodo },
  { href: "/resources", label: "Resources", icon: Users },
];

/**
 * Installer utilization, for Admin and Scheduling Manager only. The page gates
 * itself as well — hiding a nav link is not a gate.
 */
const MANAGER_NAV_ITEMS = [{ href: "/metrics", label: "Utilization", icon: Gauge }];

export default function BottomNav() {
  const pathname = usePathname();
  const { role } = useAuth();
  const { crews, rforceOrders, appointments, activeLinks, resourceMappings, timeOffRequests, flagResolutions, scheduledWorkOrders, dismissals, exportDates, cancelledTiles } = useData();

  const navItems = useMemo(
    () => (canManage(role) ? [...NAV_ITEMS, ...MANAGER_NAV_ITEMS] : NAV_ITEMS),
    [role]
  );

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

  // Same inputs, same derivations and the same counting rule as the Issues page
  // header (countIssues), so the badge and the header can't drift apart. The
  // badge shows the actionable count: a tile merely "pending" rForce is normal
  // right after booking and is not something to nag about.
  const issueCount = useMemo(
    () =>
      countIssues(
        deriveIssues(rforceOrders, appointments, activeLinks, crews, resourceMappings, scheduledWorkOrders, dismissals, cancelledTiles, exportDates),
        deriveDroppedTiles(appointments, rforceOrders, dismissals, exportDates),
        deriveAwaitingRForce(appointments, rforceOrders, dismissals, exportDates)
      ).actionable,
    [rforceOrders, appointments, activeLinks, crews, resourceMappings, scheduledWorkOrders, dismissals, exportDates, cancelledTiles]
  );

  return (
    <nav className="sticky bottom-0 z-40 bg-background border-t border-border safe-area-bottom">
      <div className="flex">
        {navItems.map(({ href, label, icon: Icon }) => {
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
