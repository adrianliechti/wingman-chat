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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    // Defer to the next frame so layout (e.g., markdown render) has settled
    requestAnimationFrame(() => {
      const container = containerElementRef.current;
      if (!container) return;

      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
    });
  }, []);

  const updateAutoScrollState = useCallback(() => {
    const container = containerElementRef.current;
    if (!container) return;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceToBottom <= bottomThreshold;

    isAutoScrollEnabledRef.current = isAtBottom;
    setIsAutoScrollEnabled(isAtBottom);
  }, [bottomThreshold]);

  const enableAutoScroll = useCallback(() => {
    isAutoScrollEnabledRef.current = true;
    setIsAutoScrollEnabled(true);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  // Track user scroll intent: leave auto-scroll when they scroll up, re-enable when near bottom
  useEffect(() => {
    const container = containerNode;
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

    // Initial check in case we're already at bottom on mount
    updateAutoScrollState();
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [containerNode, updateAutoScrollState]);

  // Auto-scroll when dependencies change (e.g., new tokens during streaming)
  useEffect(() => {
    if (isAutoScrollEnabledRef.current) {
      scrollToBottom("auto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  // Keep pinned to the bottom when content height changes (images, markdown layout)
  useEffect(() => {
    if (!bottomNode) return;
    if (typeof ResizeObserver === "undefined") return;

    const contentNode = bottomNode.parentElement;
    if (!contentNode) return;

    const resizeObserver = new ResizeObserver(() => {
      if (isAutoScrollEnabledRef.current) {
        scrollToBottom("auto");
      }
    });

    resizeObserver.observe(contentNode);

    return () => {
      resizeObserver.disconnect();
    };
  }, [bottomNode, scrollToBottom]);

  // Handle container resize (viewport changes, split panes)
  useEffect(() => {
    if (!containerNode) return;
    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => {
      if (isAutoScrollEnabledRef.current) {
        scrollToBottom("auto");
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
