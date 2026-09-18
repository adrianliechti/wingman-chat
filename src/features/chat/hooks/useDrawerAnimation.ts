import { useEffect, useState } from "react";

export function useDrawerAnimation(isOpen: boolean, exitDurationMs = 300) {
  const [isAnimating, setIsAnimating] = useState(isOpen);
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    let removeTimer: NodeJS.Timeout | undefined;
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;

    if (isOpen) {
      setShouldRender(true);
      // Two rAFs guarantee the closed (off-screen) frame is committed and
      // painted before we flip to the open state, so the CSS transition always
      // runs instead of snapping straight to the final position.
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setIsAnimating(true));
      });
      return () => {
        if (firstFrame !== undefined) cancelAnimationFrame(firstFrame);
        if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
      };
    } else {
      setIsAnimating(false);
      removeTimer = setTimeout(() => setShouldRender(false), exitDurationMs);
      return () => {
        if (removeTimer) clearTimeout(removeTimer);
      };
    }
  }, [isOpen, exitDurationMs]);

  return { isAnimating, shouldRender };
}
