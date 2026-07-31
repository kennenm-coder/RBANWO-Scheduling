"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { User as UserIcon, LogOut, Settings, Shield } from "lucide-react";
import Link from "next/link";

export default function ProfileMenu() {
  const { user, displayName, role, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!user) {
    return (
      <Link
        href="/login"
        className="p-1.5 rounded-full hover:bg-surface text-muted"
        title="Sign in"
      >
        <UserIcon size={16} />
      </Link>
    );
  }

  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const roleBadge =
    role === "admin" ? "Admin" : role === "manager" ? "Manager" : role === "read_only" ? "Read Only" : "Scheduler";

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-7 h-7 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center hover:opacity-90"
        title={displayName}
        aria-label="Profile menu"
      >
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-background border border-border rounded-xl shadow-lg z-50 py-1 animate-slide-up">
          <div className="px-3 py-2 border-b border-border">
            <div className="text-sm font-medium">{displayName}</div>
            <div className="text-[10px] text-muted">{user.email}</div>
            <div className="flex items-center gap-1 mt-1">
              <Shield size={10} className="text-primary" />
              <span className="text-[10px] text-primary font-medium">{roleBadge}</span>
            </div>
          </div>
          <Link
            href="/resources"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface"
          >
            <Settings size={14} className="text-muted" />
            Resources
          </Link>
          <button
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface text-red-500"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
