import { useRef, type TouchEvent } from "react";

/** +1 for a swipe to the left (next), -1 for a swipe to the right (previous). */
export type SwipeDirection = 1 | -1;

const MIN_DISTANCE = 50;

/**
 * Touch handlers that report a clear horizontal swipe. Vertical drags and
 * multi-finger gestures (pinch) are ignored, so scrolling and zooming stay
 * untouched. Returns no handlers without a callback, so the element can stay
 * swipe-free on desktop by passing `undefined`.
 */
export function useSwipe(onSwipe?: (direction: SwipeDirection) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  if (!onSwipe) return {};
  return {
    onTouchStart: (event: TouchEvent) => {
      start.current = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    },
    onTouchMove: (event: TouchEvent) => {
      if (event.touches.length > 1) start.current = null;
    },
    onTouchEnd: (event: TouchEvent) => {
      const origin = start.current;
      start.current = null;
      if (!origin) return;
      const dx = event.changedTouches[0].clientX - origin.x;
      const dy = event.changedTouches[0].clientY - origin.y;
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 2) return;
      onSwipe(dx < 0 ? 1 : -1);
    },
    onTouchCancel: () => {
      start.current = null;
    },
  };
}
