"use client";

import { RefreshCw } from "lucide-react";
import { useUpdateGate } from "@/lib/use-update-gate";

/**
 * "Update available" popup shown when a newer version has been deployed while
 * this tab was open. The user chooses to reload now or be reminded in 15 minutes;
 * it is never forced. See useUpdateGate for the detection + snooze logic.
 */
export default function UpdatePrompt() {
  const { updateReady, reloadNow, snooze } = useUpdateGate();
  if (!updateReady) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-4 text-foreground shadow-xl">
        <div className="mb-2 flex items-center gap-2">
          <RefreshCw size={16} className="shrink-0 text-primary" />
          <h3 className="text-sm font-semibold">Update available</h3>
        </div>
        <p className="mb-3 text-xs text-foreground/80">
          A newer version of the scheduling app is ready. Reload to get the latest —
          your saved work isn&rsquo;t affected.
        </p>
        <div className="flex gap-2">
          <button
            onClick={reloadNow}
            className="flex-1 rounded-md bg-primary py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            Reload now
          </button>
          <button
            onClick={snooze}
            className="flex-1 rounded-md bg-muted/20 py-1.5 text-xs transition-colors hover:bg-muted/40"
          >
            Remind me in 15 min
          </button>
        </div>
      </div>
    </div>
  );
}
