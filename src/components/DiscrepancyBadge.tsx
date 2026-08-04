"use client";

import { ReconciliationDifferences } from "@/lib/types";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

interface Props {
  differences?: ReconciliationDifferences;
  onClick?: (e: React.MouseEvent) => void;
}

function formatDiffLine(label: string, rforceVal: string): string {
  return `${label}: rF ${rforceVal}`;
}

export default function DiscrepancyBadge({ differences, onClick }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!differences) return null;

  const lines: string[] = [];
  if (differences.date) lines.push(formatDiffLine("Date", differences.date.rforce));
  if (differences.crew) lines.push(formatDiffLine("Crew", differences.crew.rforce));
  if (differences.time) lines.push(formatDiffLine("Time", differences.time.rforce));
  if (differences.type) lines.push(formatDiffLine("Type", differences.type.rforce));

  return (
    <div
      className="absolute top-0 right-0 z-[4]"
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) {
          onClick(e);
        } else {
          setExpanded(!expanded);
        }
      }}
    >
      <div
        className="bg-amber-500 text-white rounded-bl-md rounded-tr-lg px-1.5 py-0.5 text-[9px] font-semibold flex items-center gap-0.5 cursor-pointer hover:bg-amber-600 transition-colors"
        title={lines.join("\n")}
      >
        <AlertTriangle size={9} />
        rF
      </div>
      {expanded && (
        <div className="absolute top-full right-0 mt-0.5 bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 rounded-md shadow-lg p-2 text-[10px] text-amber-900 dark:text-amber-100 whitespace-nowrap z-[5]">
          <div className="font-semibold mb-1">rForce says different:</div>
          {lines.map((line, i) => (
            <div key={i} className="py-0.5">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
