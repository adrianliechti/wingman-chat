import { useEffect, useRef, useCallback, useState } from "react";

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
}

export function useAutoScroll({ 
  dependencies, 
  bottomThreshold = 20,
}: UseAutoScrollOptions) {
  const containerElementRef = useRef<HTMLDivElement | null>(null);
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const [bottomNode, setBottomNode] = useState<HTMLDivElement | null>(null);
  const isAutoScrollEnabledRef = useRef(true);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerElementRef.current = node;
    setContainerNode(node);
  }, []);

  const bottomRef = useCallback((node: HTMLDivElement | null) => {
    setBottomNode(node);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = containerElementRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }, []);

  const enableAutoScroll = useCallback(() => {
    isAutoScrollEnabledRef.current = true;
    setIsAutoScrollEnabled(true);
    scrollToBottom('smooth');
  }, [scrollToBottom]);

  // Auto-scroll when dependencies change (e.g., new messages during streaming)
  useEffect(() => {
    if (isAutoScrollEnabledRef.current) {
      scrollToBottom('auto');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  // Track sentinel visibility to know when we're really at the bottom
  useEffect(() => {
    if (!containerNode || !bottomNode) return;
    if (typeof IntersectionObserver === "undefined") {
      isAutoScrollEnabledRef.current = true;
      setIsAutoScrollEnabled(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;

        const isAtBottom = entry.isIntersecting;
        isAutoScrollEnabledRef.current = isAtBottom;
        setIsAutoScrollEnabled(isAtBottom);
      },
      {
        root: containerNode,
        rootMargin: `0px 0px ${bottomThreshold}px 0px`,
        threshold: [0, 1],
      }
    );

    observer.observe(bottomNode);

    return () => {
      observer.disconnect();
    };
  }, [bottomNode, bottomThreshold, containerNode]);

  // Handle container resize (important for markdown rendering)
  useEffect(() => {
    if (!containerNode) return;
    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => {
      if (isAutoScrollEnabledRef.current) {
        scrollToBottom('auto');
      }
    });

    resizeObserver.observe(containerNode);

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerNode, scrollToBottom]);

  return {
    containerRef,
    bottomRef,
    enableAutoScroll,
    isAutoScrollEnabled,
  };
}