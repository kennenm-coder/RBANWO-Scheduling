"use client";

import { useState } from "react";
import { useData } from "@/components/DataProvider";
import CrewManager from "@/components/CrewManager";
import CsvUploader from "@/components/CsvUploader";
import { Loader2 } from "lucide-react";

type Tab = "crews" | "csv";

export default function AdminPage() {
  const { loading } = useData();
  const [tab, setTab] = useState<Tab>("crews");

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

      <div className="flex border-b border-border">
        <button
          onClick={() => setTab("crews")}
          className={`flex-1 py-2.5 text-sm font-medium text-center ${
            tab === "crews"
              ? "text-primary border-b-2 border-primary"
              : "text-muted"
          }`}
        >
          Crew Members
        </button>
        <button
          onClick={() => setTab("csv")}
          className={`flex-1 py-2.5 text-sm font-medium text-center ${
            tab === "csv"
              ? "text-primary border-b-2 border-primary"
              : "text-muted"
          }`}
        >
          CSV Import
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "crews" ? <CrewManager /> : <CsvUploader />}
      </div>
    </div>
  );
}
