"use client";

import { useData } from "@/components/DataProvider";
import UnscheduledQueue from "@/components/UnscheduledQueue";
import { Loader2 } from "lucide-react";

export default function QueuePage() {
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
        <h1 className="text-lg font-semibold">Scheduling Queue</h1>
        <p className="text-xs text-muted">
          Reconciliation between app scheduling and rForce CSV data
        </p>
      </header>
      <UnscheduledQueue />
    </div>
  );
}
