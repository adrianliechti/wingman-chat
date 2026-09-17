import { useEffect, useState } from "react";

export function useDrawerAnimation(isOpen: boolean, exitDurationMs = 300) {
  const [isAnimating, setIsAnimating] = useState(isOpen);
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    let animationTimer: NodeJS.Timeout | undefined;
    let removeTimer: NodeJS.Timeout | undefined;

    if (isOpen) {
      // Schedule render first, then animate
      const renderTimer = setTimeout(() => {
        setShouldRender(true);
        animationTimer = setTimeout(() => setIsAnimating(true), 10);
      }, 0);
      return () => {
        clearTimeout(renderTimer);
        if (animationTimer) clearTimeout(animationTimer);
      };
    } else {
      // Schedule animation removal first, then unmount
      animationTimer = setTimeout(() => setIsAnimating(false), 0);
      removeTimer = setTimeout(() => setShouldRender(false), exitDurationMs);
      return () => {
        if (animationTimer) clearTimeout(animationTimer);
        if (removeTimer) clearTimeout(removeTimer);
      };
    }
  }, [isOpen, exitDurationMs]);

  return { isAnimating, shouldRender };
}
