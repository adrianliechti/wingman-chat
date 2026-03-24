import { useEffect, useRef, useCallback, useState } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";

interface UseAutoScrollOptions {
  /** The mounted scrollable container element. */
  scrollElement: HTMLDivElement | null;
  /** Virtualizer instance — count is read from virtualizer.options.count. */
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** Pixel distance from bottom that still counts as "at bottom". */
  bottomThreshold?: number;
}

export function useAutoScroll({
  scrollElement,
  virtualizer,
  bottomThreshold = 48,
}: UseAutoScrollOptions) {
  const pinnedRef = useRef(true);
  const [isPinned, setIsPinned] = useState(true);
  const unpinTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rafRef = useRef(0);

  const isAtBottom = useCallback(() => {
    if (!scrollElement) return true;
    return scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <= bottomThreshold;
  }, [scrollElement, bottomThreshold]);

  // Scroll to the last virtual item (sentinel). Reading count at call-time
  // avoids a dependency on it and prevents stale closures.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (!scrollElement) return;
    const count = virtualizer.options.count;
    if (count === 0) return;
    virtualizer.scrollToIndex(count - 1, { align: "end", behavior });
  }, [scrollElement, virtualizer]);

  // Debounced unpin UI: pinnedRef is set immediately (gates ResizeObserver
  // scrolling), but the React state that shows "Latest" is debounced so the
  // button doesn't flicker during fast streaming when isAtBottom() briefly
  // returns false between a resize and the corrective scroll.
  useEffect(() => {
    if (!scrollElement) return;

    const onScroll = () => {
      if (isAtBottom()) {
        clearTimeout(unpinTimerRef.current);
        pinnedRef.current = true;
        setIsPinned((c) => (c ? c : true));
      } else {
        // Stop the ResizeObserver from scrolling immediately.
        pinnedRef.current = false;
        // Delay the UI update so the "Latest" button doesn't flash.
        clearTimeout(unpinTimerRef.current);
        unpinTimerRef.current = setTimeout(() => {
          if (!isAtBottom()) {
            setIsPinned(false);
          }
        }, 150);
      }
    };

    onScroll();
    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", onScroll);
      clearTimeout(unpinTimerRef.current);
    };
  }, [scrollElement, isAtBottom]);

  // Keep pinned during late layout changes (streaming, images, measurement).
  // Throttled to one scrollToBottom per animation frame.
  useEffect(() => {
    if (!scrollElement) return;

    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        scrollToBottom("auto");
      });
    });

    const content = scrollElement.firstElementChild;
    if (content) observer.observe(content);
    observer.observe(scrollElement);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [scrollElement, scrollToBottom]);

  const enableAutoScroll = useCallback(() => {
    clearTimeout(unpinTimerRef.current);
    pinnedRef.current = true;
    setIsPinned(true);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  return {
    enableAutoScroll,
    isAutoScrollEnabled: isPinned,
    scrollToBottom,
  };
}
