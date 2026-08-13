import { useEffect } from "react";

/**
 * Calls `handler` when the Escape key is pressed.
 * Attaches a keydown listener to `document` so the modal
 * doesn't need to be focusable.
 */
export function useEscapeKey(handler: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        handler();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handler]);
}
