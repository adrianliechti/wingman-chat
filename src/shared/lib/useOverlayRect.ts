import { useEffect, useState } from "react";

export interface OverlayRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Tracks the viewport rect of `target` so a `position: fixed` element can be
 * overlaid on top of it and follow scrolling/resizing. Used to "move" a
 * persistent iframe between an inline slot and the drawer without reparenting
 * (which would reload the iframe). Returns null while there is no target.
 *
 * Position is re-read via requestAnimationFrame while mounted — cheap, and the
 * only reliable way to follow a scrolling ancestor (scroll events don't fire for
 * every nested scroller, and ResizeObserver doesn't catch position-only moves).
 */
export function useOverlayRect(target: HTMLElement | null): OverlayRect | null {
  const [rect, setRect] = useState<OverlayRect | null>(null);

  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }

    let frame = 0;
    let prev: OverlayRect | null = null;

    const tick = () => {
      const r = target.getBoundingClientRect();
      const next = { top: r.top, left: r.left, width: r.width, height: r.height };
      if (
        !prev ||
        prev.top !== next.top ||
        prev.left !== next.left ||
        prev.width !== next.width ||
        prev.height !== next.height
      ) {
        prev = next;
        setRect(next);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return rect;
}
