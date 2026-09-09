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
import { presenceColorForUser } from "./preferences";

const CHANNEL = "sched-presence";
// Trailing-edge throttle window. Coalesces a fast cell-to-cell sweep into at
// most one send per window while GUARANTEEING the final resting cell is sent
// (never dropped). 100ms → ≤10 events/s, matching Supabase's default cap.
const CURSOR_THROTTLE_MS = 100;
// Re-broadcast the current cell on this cadence so a parked mouse doesn't get
// swept away by peers' expiry timers.
const HEARTBEAT_MS = 20_000;
// Peers drop a cursor we haven't heard about in this long (covers a tab that
// crashed or closed without emitting a leave).
const CURSOR_EXPIRY_MS = 45_000;
const EXPIRY_SWEEP_MS = 10_000;
// No mouse/keyboard/scroll activity for this long marks the local user "idle";
// their highlight dims for peers so a parked-but-open tab reads as not actively
// looking. Checked on IDLE_CHECK_MS cadence (cheap; activity only writes a ref).
const IDLE_MS = 30 * 60_000;
const IDLE_CHECK_MS = 30_000;

export interface Peer {
  userId: string;
  name: string;
  color: string;
  view: string; // "day" | "week" | "block"
  dateKeys: string[]; // yyyy-MM-dd this peer is currently viewing
  idle: boolean; // no recent activity — dim this peer's highlight
}

export interface PresenceIdentity {
  userId: string;
  name: string;
  color: string;
  view: string;
  dateKeys: string[];
}

interface PeerCursor {
  cell: string;
  at: number; // last time we heard this cursor (ms epoch)
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

/** Both views key cells as "crew|date"; day-with-blocks may append "|block".
 *  Collapse to the crew|date prefix so a week hover and a day hover of the same
 *  crew/day line up, and so lookups are O(1) against a prebuilt map. */
function cellPrefix(cell: string): string {
  const p = cell.split("|");
  return p.length <= 2 ? cell : p.slice(0, 2).join("|");
}

/** Fade a #rrggbb presence color to a faint translucent fill, used to signal an
 *  idle peer's highlight (visible but clearly de-emphasized). Falls back to the
 *  original string if it isn't a plain 6-digit hex. */
function dimColor(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.3)`;
}

/**
 * Sets up the shared presence channel for the given identity. Returns the
 * context value. When there is no Supabase client, returns the inert no-op.
 */
export function usePresenceChannel(identity: PresenceIdentity | null): PresenceContextValue {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [peerCells, setPeerCells] = useState<Record<string, PeerCursor>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Last value we actually broadcast, and when — drives the trailing throttle.
  const lastSentRef = useRef<{ cell: string | null; at: number }>({ cell: null, at: 0 });
  // A queued trailing send: the latest cell, plus its timer handle.
  const pendingRef = useRef<{ cell: string | null; timer: ReturnType<typeof setTimeout> | null }>({
    cell: null,
    timer: null,
  });
  // Latest identity, readable from stable callbacks without re-subscribing.
  const identityRef = useRef(identity);
  identityRef.current = identity;
  // Local idle state + last-activity timestamp. When idle, our presence carries
  // idle:true so peers dim our highlight.
  const idleRef = useRef(false);
  const lastActivityRef = useRef(Date.now());

  const userId = identity?.userId ?? null;
  // Stable string of the presence payload so the effect re-tracks on change.
  const trackKey = identity
    ? `${identity.view}|${identity.dateKeys.join(",")}|${identity.name}|${identity.color}`
    : null;

  // Publish our presence meta (identity + idle). Called on subscribe, on
  // view/date change, and when idle state flips.
  const trackNow = useCallback(() => {
    const channel = channelRef.current;
    const id = identityRef.current;
    if (!channel || !id) return;
    void channel.track({
      name: id.name,
      color: id.color,
      view: id.view,
      dateKeys: id.dateKeys,
      idle: idleRef.current,
    });
  }, []);

  // Stable low-level sender: pushes a cursor immediately, bypassing the
  // throttle. Reads channel/identity from refs so it never needs re-creating.
  const emit = useCallback((cell: string | null) => {
    const channel = channelRef.current;
    const id = identityRef.current;
    if (!channel || !id) return;
    lastSentRef.current = { cell, at: Date.now() };
    void channel.send({
      type: "broadcast",
      event: "cursor",
      payload: { userId: id.userId, cell },
    });
  }, []);

  // Force-clear our cursor (leaving the window/tab). Cancels any pending send
  // and emits null even while hidden.
  const clearCursor = useCallback(() => {
    if (pendingRef.current.timer) {
      clearTimeout(pendingRef.current.timer);
      pendingRef.current.timer = null;
    }
    if (lastSentRef.current.cell !== null) emit(null);
  }, [emit]);

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
          color: m.color || presenceColorForUser(key),
          view: m.view || "week",
          dateKeys: Array.isArray(m.dateKeys) ? m.dateKeys : [],
          idle: !!m.idle,
        });
      }
      setPeers(next);
      // Drop cursors for peers who left.
      setPeerCells((prev) => {
        const alive = new Set(next.map((p) => p.userId));
        const filtered: Record<string, PeerCursor> = {};
        for (const [uid, cur] of Object.entries(prev)) if (alive.has(uid)) filtered[uid] = cur;
        return filtered;
      });
    });

    channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
      const { userId: uid, cell } = (payload || {}) as { userId?: string; cell?: string | null };
      if (!uid || uid === identity.userId) return;
      setPeerCells((prev) => {
        const next = { ...prev };
        if (cell) next[uid] = { cell, at: Date.now() };
        else delete next[uid];
        return next;
      });
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Fresh connection: forget what we thought we last sent so the next
        // hover re-emits even if the cell string is unchanged.
        lastSentRef.current = { cell: null, at: 0 };
        trackNow();
      }
    });

    // Re-broadcast a parked cursor so peers' expiry sweeps don't drop it.
    const heartbeat = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (lastSentRef.current.cell) emit(lastSentRef.current.cell);
    }, HEARTBEAT_MS);

    // Expire peer cursors we haven't heard from (crashed/closed tabs).
    const sweep = setInterval(() => {
      const cutoff = Date.now() - CURSOR_EXPIRY_MS;
      setPeerCells((prev) => {
        let changed = false;
        const next: Record<string, PeerCursor> = {};
        for (const [uid, cur] of Object.entries(prev)) {
          if (cur.at >= cutoff) next[uid] = cur;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, EXPIRY_SWEEP_MS);

    // Clear our own cursor whenever the pointer leaves the page or the tab is
    // backgrounded, so peers never see a stuck ring.
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.hidden) clearCursor();
    };
    window.addEventListener("blur", clearCursor);
    window.addEventListener("pagehide", clearCursor);
    document.addEventListener("mouseleave", clearCursor);
    document.addEventListener("visibilitychange", onVisibility);

    // Idle detection: any real activity just stamps a ref (cheap); coming back
    // from idle re-publishes presence so peers un-dim us. A timer flips us to
    // idle after IDLE_MS of silence.
    const markActive = () => {
      lastActivityRef.current = Date.now();
      if (idleRef.current) {
        idleRef.current = false;
        trackNow();
      }
    };
    window.addEventListener("mousemove", markActive, { passive: true });
    window.addEventListener("keydown", markActive);
    window.addEventListener("pointerdown", markActive, { passive: true });
    window.addEventListener("scroll", markActive, { passive: true, capture: true });
    const idleCheck = setInterval(() => {
      if (!idleRef.current && Date.now() - lastActivityRef.current >= IDLE_MS) {
        idleRef.current = true;
        trackNow();
      }
    }, IDLE_CHECK_MS);

    return () => {
      clearInterval(heartbeat);
      clearInterval(sweep);
      clearInterval(idleCheck);
      window.removeEventListener("blur", clearCursor);
      window.removeEventListener("pagehide", clearCursor);
      document.removeEventListener("mouseleave", clearCursor);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("mousemove", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("scroll", markActive, { capture: true } as EventListenerOptions);
      // Intentionally read the live ref: cancel whatever trailing send is queued
      // at teardown time (this ref holds a timer handle, not a DOM node).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const pending = pendingRef.current;
      if (pending.timer) {
        clearTimeout(pending.timer);
        pending.timer = null;
      }
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
    if (!channelRef.current || !identity) return;
    trackNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  const setHoveredCell = useCallback(
    (cell: string | null) => {
      if (!channelRef.current || !identityRef.current) return;
      // Suppress only *entering* a cell while hidden; clearing (null) always
      // goes through so a backgrounded tab can't leave a stuck ring.
      if (cell !== null && typeof document !== "undefined" && document.hidden) return;

      // A trailing send is already queued — just retarget it to the latest cell
      // so whatever we settle on is what peers receive.
      if (pendingRef.current.timer) {
        pendingRef.current.cell = cell;
        return;
      }
      if (cell === lastSentRef.current.cell) return; // nothing changed

      const elapsed = Date.now() - lastSentRef.current.at;
      if (elapsed >= CURSOR_THROTTLE_MS) {
        emit(cell); // leading edge: idle long enough, send now
      } else {
        // Inside the window: queue a trailing send carrying the final value.
        pendingRef.current.cell = cell;
        pendingRef.current.timer = setTimeout(() => {
          const c = pendingRef.current.cell;
          pendingRef.current.timer = null;
          if (c !== lastSentRef.current.cell) emit(c);
        }, CURSOR_THROTTLE_MS - elapsed);
      }
    },
    [emit]
  );

  // Public string view of peer cells (uid → cell), for any external consumer.
  const publicPeerCells = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [uid, cur] of Object.entries(peerCells)) out[uid] = cur.cell;
    return out;
  }, [peerCells]);

  // Prebuilt crew|date → color map. Built from peerCells (not peers) so a
  // cursor that arrives before its presence sync still renders, falling back to
  // the deterministic per-user color.
  const colorByCell = useMemo(() => {
    const byId = new Map(peers.map((p) => [p.userId, p]));
    const map = new Map<string, string>();
    for (const [uid, cur] of Object.entries(peerCells)) {
      const peer = byId.get(uid);
      const base = peer?.color || presenceColorForUser(uid);
      // Idle peers keep their hue but fade back, so the highlight reads as
      // "parked here, not actively looking."
      map.set(cellPrefix(cur.cell), peer?.idle ? dimColor(base) : base);
    }
    return map;
  }, [peers, peerCells]);

  const hoverColorFor = useCallback(
    (cellKey: string): string | null => colorByCell.get(cellPrefix(cellKey)) ?? null,
    [colorByCell]
  );

  return useMemo(
    () => ({
      selfId: identity?.userId ?? null,
      peers,
      peerCells: publicPeerCells,
      setHoveredCell,
      hoverColorFor,
    }),
    [identity?.userId, peers, publicPeerCells, setHoveredCell, hoverColorFor]
  );
}

export { PresenceContext };
