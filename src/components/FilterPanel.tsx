"use client";

import { AppointmentType } from "@/lib/types";

interface Props {
  value: AppointmentType | "all";
  onChange: (v: AppointmentType | "all") => void;
}

const OPTIONS: { value: AppointmentType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tech_measure", label: "Measure" },
  { value: "install", label: "Install" },
  { value: "service", label: "Service" },
  { value: "jip", label: "JIP" },
];

export default function FilterPanel({ value, onChange }: Props) {
  return (
    <div className="flex gap-1 px-4 py-2 overflow-x-auto">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            value === opt.value
              ? "bg-primary text-white"
              : "bg-surface text-muted hover:bg-border"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
