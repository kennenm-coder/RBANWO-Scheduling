"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Detects when a newer version of the app has been deployed while a tab is still
 * open, and drives the "Update available" prompt (see UpdatePrompt.tsx).
 *
 * How it works: every build stamps public/version.json with a fresh version
 * (scripts/gen-version.mjs). A tab records the version it booted with, then
 * re-checks that file on focus and on a slow interval. A changed value means a
 * new deploy is live, so the tab is stale.
 *
 * Egress: each check is a single request for /version.json (~30 bytes) served by
 * the HOST/CDN, never Supabase — so this has no effect on Supabase egress. Checks
 * are skipped while the tab is hidden.
 *
 * Never forces a reload: the user chooses "Reload now" or "Remind me in 15 min".
 * Snooze re-asks after 15 minutes, forever, until they reload. All timers live in
 * memory, so a manual browser reload (or the Reload button) tears them down — a
 * snooze can never linger past an update.
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000; // re-check every 5 min while visible
const SNOOZE_MS = 15 * 60 * 1000; // "Remind me in 15 min"
const DEFER_RETRY_MS = 45 * 1000; // retry soon when a dialog is open
const VERSION_URL = "/version.json";

async function fetchDeployedVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${VERSION_URL}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    // Offline / blocked — a version check must never disrupt the app.
    return null;
  }
}

/**
 * True while any app modal/overlay is open (they render as `fixed inset-0`), so
 * the update prompt won't pop over in-progress work like an open ScheduleModal.
 */
function isOverlayOpen(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector(".fixed.inset-0");
}

export interface UpdateGate {
  updateReady: boolean;
  reloadNow: () => void;
  snooze: () => void;
}

export function useUpdateGate(): UpdateGate {
  const [updateReady, setUpdateReady] = useState(false);

  const bootVersionRef = useRef<string | null>(null);
  const snoozingRef = useRef(false);
  const deferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snoozeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDefer = () => {
    if (deferTimerRef.current) {
      clearTimeout(deferTimerRef.current);
      deferTimerRef.current = null;
    }
  };

  // Reveal the prompt — unless a snooze is active, or another dialog is open, in
  // which case retry shortly so we never stack on top of an open modal.
  const tryShow = useCallback(() => {
    if (snoozingRef.current) return;
    if (isOverlayOpen()) {
      clearDefer();
      deferTimerRef.current = setTimeout(tryShow, DEFER_RETRY_MS);
      return;
    }
    setUpdateReady(true);
  }, []);

  const check = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    const v = await fetchDeployedVersion();
    if (!v) return;
    if (bootVersionRef.current === null) {
      bootVersionRef.current = v; // first successful read establishes the baseline
      return;
    }
    // Any change from the booted version means a newer deploy is live. Multiple
    // deploys during a snooze coalesce into this one pending prompt.
    if (v !== bootVersionRef.current) tryShow();
  }, [tryShow]);

  const reloadNow = useCallback(() => {
    // Full reload discards this page and every timer on it, then boots on the new
    // version — so it won't immediately re-prompt and no snooze can survive.
    window.location.reload();
  }, []);

  const snooze = useCallback(() => {
    setUpdateReady(false);
    snoozingRef.current = true;
    if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    snoozeTimerRef.current = setTimeout(() => {
      snoozingRef.current = false;
      tryShow(); // 15 min later, ask again — still never forced
    }, SNOOZE_MS);
  }, [tryShow]);

  useEffect(() => {
    check(); // baseline + immediate check on mount
    const interval = setInterval(check, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearDefer();
      if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    };
  }, [check]);

  return { updateReady, reloadNow, snooze };
}
