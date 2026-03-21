import { useEffect, useRef, useCallback, useState } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";

interface UseAutoScrollOptions {
  /**
   * The virtualizer instance used for scrollToIndex.
   */
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  /**
   * Total item count (used for scrollToIndex).
   */
  count: number;
  /**
   * Dependencies that trigger auto-scroll when changed (e.g., messages, chat)
   */
  dependencies: unknown[];
  /**
   * Pixel distance from the very bottom that still counts as "at bottom".
   * Defaults to 20 px for touchpad-friendly sensitivity.
   */
  bottomThreshold?: number;
}

export function useAutoScroll({
  virtualizer,
  count,
  dependencies,
  bottomThreshold = 20,
}: UseAutoScrollOptions) {
  const isAutoScrollEnabledRef = useRef(true);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (count === 0) return;
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(count - 1, { align: 'end', behavior });
    });
  }, [virtualizer, count]);

  const updateAutoScrollState = useCallback(() => {
    const container = virtualizer.scrollElement;
    if (!container) return;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceToBottom <= bottomThreshold;

    isAutoScrollEnabledRef.current = isAtBottom;
    setIsAutoScrollEnabled(isAtBottom);
  }, [virtualizer, bottomThreshold]);

  const enableAutoScroll = useCallback(() => {
    isAutoScrollEnabledRef.current = true;
    setIsAutoScrollEnabled(true);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  // Track user scroll intent
  useEffect(() => {
    const container = virtualizer.scrollElement;
    if (!container) return;

    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateAutoScrollState();
      });
    };

    updateAutoScrollState();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [virtualizer.scrollElement, updateAutoScrollState]);

  // Auto-scroll when dependencies change (e.g., new tokens during streaming)
  useEffect(() => {
    if (isAutoScrollEnabledRef.current) {
      scrollToBottom("auto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return {
    enableAutoScroll,
    isAutoScrollEnabled,
  };
}
