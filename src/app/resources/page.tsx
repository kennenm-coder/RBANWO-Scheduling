"use client";

import { useData } from "@/components/DataProvider";
import ResourceManager from "@/components/ResourceManager";
import { Loader2 } from "lucide-react";

export default function ResourcesPage() {
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
        <h1 className="text-lg font-semibold">Resources</h1>
      </header>
      <div className="flex-1 overflow-auto">
        <ResourceManager />
      </div>
    </div>
  );
}
