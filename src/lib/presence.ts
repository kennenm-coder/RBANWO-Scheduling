"use client";

// ─── Live presence (visual-only) ────────────────────────────────────────────
// Google-Sheets-style "who's here" + live hover highlight, built on Supabase
// Realtime Presence (who is viewing which days) + Broadcast (which cell a
// person's mouse is over). This layer is PURELY VISUAL: it never reads or
// writes appointment data, and degrades to a silent no-op if realtime is
// unavailable, so it can never affect scheduling functionality.

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

const CHANNEL = "sched-presence";
const CURSOR_MIN_INTERVAL_MS = 60; // throttle floor; we already emit on cell-change only

export interface Peer {
  userId: string;
  name: string;
  color: string;
  view: string; // "day" | "week" | "block"
  dateKeys: string[]; // yyyy-MM-dd this peer is currently viewing
}

export interface PresenceIdentity {
  userId: string;
  name: string;
  color: string;
  view: string;
  dateKeys: string[];
}

interface PresenceContextValue {
  selfId: string | null;
  /** Everyone else currently connected (self excluded). */
  peers: Peer[];
  /** userId → hovered cell key ("crewId|yyyy-MM-dd[|block]"). */
  peerCells: Record<string, string>;
  /** Report the cell the local mouse is over (null on leave). Emits on change only. */
  setHoveredCell: (cell: string | null) => void;
  /** Color of a peer hovering a cell matching this key, or null. Cross-view aware. */
  hoverColorFor: (cellKey: string) => string | null;
}

const noop: PresenceContextValue = {
  selfId: null,
  peers: [],
  peerCells: {},
  setHoveredCell: () => {},
  hoverColorFor: () => null,
};

const PresenceContext = createContext<PresenceContextValue>(noop);

export function usePresence() {
  return useContext(PresenceContext);
}

/** Segment-prefix match so a week hover ("crew|date") lines up with a day hover
 *  ("crew|date|block") and vice-versa. */
function cellsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const as = a.split("|");
  const bs = b.split("|");
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) if (as[i] !== bs[i]) return false;
  return true;
}

/**
 * Sets up the shared presence channel for the given identity. Returns the
 * context value. When there is no Supabase client, returns the inert no-op.
 */
export function usePresenceChannel(identity: PresenceIdentity | null): PresenceContextValue {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [peerCells, setPeerCells] = useState<Record<string, string>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef<{ cell: string | null; at: number }>({ cell: null, at: 0 });

  const userId = identity?.userId ?? null;
  // Stable string of the presence payload so the effect re-tracks on change.
  const trackKey = identity
    ? `${identity.view}|${identity.dateKeys.join(",")}|${identity.name}|${identity.color}`
    : null;

  useEffect(() => {
    if (!identity) return;
    const sb = getSupabase();
    if (!sb) return;

    const channel = sb.channel(CHANNEL, {
      config: { presence: { key: identity.userId }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, Array<Partial<Peer>>>;
      const next: Peer[] = [];
      for (const [key, metas] of Object.entries(state)) {
        if (key === identity.userId) continue;
        const m = metas[metas.length - 1] || {};
        next.push({
          userId: key,
          name: m.name || "Someone",
          color: m.color || "#64748b",
          view: m.view || "week",
          dateKeys: Array.isArray(m.dateKeys) ? m.dateKeys : [],
        });
      }
      setPeers(next);
      // Drop cursors for peers who left.
      setPeerCells((prev) => {
        const alive = new Set(next.map((p) => p.userId));
        const filtered: Record<string, string> = {};
        for (const [uid, cell] of Object.entries(prev)) if (alive.has(uid)) filtered[uid] = cell;
        return filtered;
      });
    });

    channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
      const { userId: uid, cell } = (payload || {}) as { userId?: string; cell?: string | null };
      if (!uid || uid === identity.userId) return;
      setPeerCells((prev) => {
        const next = { ...prev };
        if (cell) next[uid] = cell;
        else delete next[uid];
        return next;
      });
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.track({
          name: identity.name,
          color: identity.color,
          view: identity.view,
          dateKeys: identity.dateKeys,
        });
      }
    });

    return () => {
      try {
        sb.removeChannel(channel);
      } catch {
        /* ignore */
      }
      channelRef.current = null;
    };
    // Re-subscribe only when the user identity itself changes; presence payload
    // updates (view/date) are pushed via the trackKey effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Push presence updates (view/date changes) without tearing down the channel.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !identity) return;
    void channel.track({
      name: identity.name,
      color: identity.color,
      view: identity.view,
      dateKeys: identity.dateKeys,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  const setHoveredCell = useCallback(
    (cell: string | null) => {
      const channel = channelRef.current;
      if (!channel || !identity) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const now = Date.now();
      const last = lastSentRef.current;
      if (cell === last.cell) return; // emit on change only
      if (now - last.at < CURSOR_MIN_INTERVAL_MS && cell !== null) return;
      lastSentRef.current = { cell, at: now };
      void channel.send({
        type: "broadcast",
        event: "cursor",
        payload: { userId: identity.userId, cell },
      });
    },
    [identity]
  );

  const hoverColorFor = useCallback(
    (cellKey: string): string | null => {
      for (const p of peers) {
        const cell = peerCells[p.userId];
        if (cell && cellsMatch(cell, cellKey)) return p.color;
      }
      return null;
    },
    [peers, peerCells]
  );

  return useMemo(
    () => ({ selfId: identity?.userId ?? null, peers, peerCells, setHoveredCell, hoverColorFor }),
    [identity?.userId, peers, peerCells, setHoveredCell, hoverColorFor]
  );
}

export { PresenceContext };
