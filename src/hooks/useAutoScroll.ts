import { useEffect, useRef, useCallback } from "react";

interface UseAutoScrollOptions {
  /**
   * Dependencies that trigger auto-scroll when changed (e.g., messages, chat)
   */
  dependencies: unknown[];
}

export function useAutoScroll({ dependencies }: UseAutoScrollOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabledRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);

  const scrollToBottom = () => {
    if (bottomRef.current) {
      isProgrammaticScrollRef.current = true;
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
      // Reset flag after scroll completes
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 500);
    }
  };

  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;
    
    const container = containerRef.current;
    if (!container) return;

    // Check if user is at bottom (with small threshold)
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 10;
    isAutoScrollEnabledRef.current = isAtBottom;
  }, []);

  const enableAutoScroll = useCallback(() => {
    isAutoScrollEnabledRef.current = true;
    scrollToBottom();
  }, []);

  // Auto-scroll when dependencies change if enabled
  useEffect(() => {
    if (isAutoScrollEnabledRef.current) {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return { containerRef, bottomRef, handleScroll, enableAutoScroll };
}
