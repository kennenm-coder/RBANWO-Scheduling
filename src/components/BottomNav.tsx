"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ListTodo, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Calendar", icon: CalendarDays },
  { href: "/queue", label: "Queue", icon: ListTodo },
  { href: "/admin", label: "Admin", icon: Settings },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-40 bg-background border-t border-border safe-area-bottom">
      <div className="flex">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-xs font-medium transition-colors ${
                active
                  ? "text-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
