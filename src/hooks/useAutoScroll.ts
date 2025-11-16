import { useEffect, useRef, useCallback } from "react";

interface UseAutoScrollOptions {
  /**
   * Dependencies that trigger auto-scroll when changed (e.g., messages, chat)
   */
  dependencies: unknown[];
  /**
   * Pixel distance from the very bottom that still counts as "at bottom".
   * Defaults to 20 px for touchpad-friendly sensitivity.
   */
  bottomThreshold?: number;
  /**
   * Delay in ms to debounce scroll during streaming. Defaults to 100ms.
   */
  scrollDebounceMs?: number;
}

export function useAutoScroll({ 
  dependencies, 
  bottomThreshold = 20,
  scrollDebounceMs = 100 
}: UseAutoScrollOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabledRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const rafIdRef = useRef<number | undefined>(undefined);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Cancel any pending scroll animation
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }

    // Mark as programmatic scroll
    isProgrammaticScrollRef.current = true;

    // Use requestAnimationFrame for smooth scrolling during streaming
    const performScroll = () => {
      const targetScrollTop = container.scrollHeight - container.clientHeight;
      
      // Use instant scrolling during streaming for better performance
      // Only use smooth scrolling for user-triggered scrolls
      container.scrollTop = targetScrollTop;
      
      // Reset programmatic flag after a short delay
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 50);
    };

    rafIdRef.current = requestAnimationFrame(performScroll);
  }, []);

  const handleScroll = useCallback(() => {
    // Ignore programmatic scrolls
    if (isProgrammaticScrollRef.current) return;
    
    const container = containerRef.current;
    if (!container) return;

    // Calculate if user is at bottom
    const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = scrollBottom <= bottomThreshold;
    
    // Update auto-scroll state
    isAutoScrollEnabledRef.current = isAtBottom;
  }, [bottomThreshold]);

  const enableAutoScroll = useCallback(() => {
    isAutoScrollEnabledRef.current = true;
    scrollToBottom();
  }, [scrollToBottom]);

  // Debounced auto-scroll for streaming content
  useEffect(() => {
    if (!isAutoScrollEnabledRef.current) return;

    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Debounce scrolling during rapid updates (streaming)
    scrollTimeoutRef.current = setTimeout(() => {
      if (isAutoScrollEnabledRef.current) {
        scrollToBottom();
      }
    }, scrollDebounceMs);

    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Handle container resize (important for markdown rendering)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      if (isAutoScrollEnabledRef.current) {
        scrollToBottom();
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [scrollToBottom]);

  return {
    containerRef,
    bottomRef,
    handleScroll,
    enableAutoScroll,
    isAutoScrollEnabled: isAutoScrollEnabledRef,
  };
}