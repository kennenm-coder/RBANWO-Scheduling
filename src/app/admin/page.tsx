"use client";

import { useData } from "@/components/DataProvider";
import { Loader2 } from "lucide-react";

export default function AdminPage() {
  const { loading } = useData();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3 sticky top-0 z-30">
        <h1 className="text-lg font-semibold">Admin</h1>
      </header>
      <div className="flex-1 overflow-auto p-4">
        <p className="text-sm text-muted">Data is synced automatically from the calendar app.</p>
      </div>
    </div>
  );
}
