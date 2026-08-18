"use client";

import { RefObject, useEffect } from "react";

/** Distance (px) from an edge at which auto-scroll kicks in. */
const EDGE = 90;
/** Max scroll speed (px/frame) reached at the very edge. */
const MAX_SPEED = 22;

/**
 * Auto-scrolls a container while an HTML5 drag is in progress and the cursor
 * nears its top/bottom edge. Native drag-and-drop does not scroll inner
 * containers (and suppresses the wheel), so without this you can only drop onto
 * resources already visible on screen. Speed ramps with how deep into the edge
 * zone the cursor is, and a rAF loop keeps scrolling even while the cursor holds
 * still at the edge (where `dragover` stops firing).
 *
 * @param containerRef the scrollable element to pan
 * @param active       whether a drag is currently in progress
 */
export function useDragAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean
) {
  useEffect(() => {
    if (!active) return;

    let pointerY = 0;
    let hasPointer = false;
    let raf = 0;

    function onDragOver(e: DragEvent) {
      pointerY = e.clientY;
      hasPointer = true;
    }

    function step() {
      const el = containerRef.current;
      if (el && hasPointer) {
        const rect = el.getBoundingClientRect();
        let delta = 0;
        if (pointerY < rect.top + EDGE) {
          const intensity = Math.min((rect.top + EDGE - pointerY) / EDGE, 1);
          delta = -MAX_SPEED * intensity;
        } else if (pointerY > rect.bottom - EDGE) {
          const intensity = Math.min((pointerY - (rect.bottom - EDGE)) / EDGE, 1);
          delta = MAX_SPEED * intensity;
        }
        if (delta !== 0) el.scrollTop += delta;
      }
      raf = requestAnimationFrame(step);
    }

    // Capture phase so we still see dragover even when inner drop targets
    // stopPropagation on it.
    window.addEventListener("dragover", onDragOver, true);
    raf = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("dragover", onDragOver, true);
      cancelAnimationFrame(raf);
    };
  }, [active, containerRef]);
}
