import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface UseAutoScrollOptions {
  resetKey?: string | null;
  bottomThreshold?: number;
}

export function useAutoScroll({ resetKey, bottomThreshold = 48 }: UseAutoScrollOptions) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [isAutoFollowEnabled, setIsAutoFollowEnabled] = useState(true);
  const lastResetKeyRef = useRef(resetKey);
  const lastScrollTopRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollRafRef = useRef(0);
  const contentResizeRafRef = useRef(0);

  const clearProgrammaticScrollGuard = useCallback(() => {
    cancelAnimationFrame(programmaticScrollRafRef.current);
  }, []);

  const isAtBottom = useCallback(() => {
    if (!scrollElement) return true;
    return scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <= bottomThreshold;
  }, [bottomThreshold, scrollElement]);

  const scrollToBottom = useCallback(() => {
    if (!scrollElement) return;

    clearProgrammaticScrollGuard();
    programmaticScrollRef.current = true;
    scrollElement.scrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);

    programmaticScrollRafRef.current = requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
      lastScrollTopRef.current = scrollElement.scrollTop;
    });
  }, [clearProgrammaticScrollGuard, scrollElement]);

  const handleScrollContainerRef = useCallback((element: HTMLDivElement | null) => {
    setScrollElement(element);
  }, []);

  const goToLatest = useCallback(() => {
    setIsAutoFollowEnabled(true);
    scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
    if (!scrollElement) return;
    lastScrollTopRef.current = scrollElement.scrollTop;
  }, [scrollElement]);

  useLayoutEffect(() => {
    if (lastResetKeyRef.current === resetKey) return;

    lastResetKeyRef.current = resetKey;
    setIsAutoFollowEnabled(true);
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  useLayoutEffect(() => {
    if (!scrollElement || !isAutoFollowEnabled) return;
    scrollToBottom();
  }, [isAutoFollowEnabled, scrollElement, scrollToBottom]);

  useEffect(() => {
    if (!scrollElement) return;

    const onScroll = () => {
      const currentScrollTop = scrollElement.scrollTop;
      const previousScrollTop = lastScrollTopRef.current;
      lastScrollTopRef.current = currentScrollTop;

      if (programmaticScrollRef.current) return;

      if (isAutoFollowEnabled && currentScrollTop < previousScrollTop - 2 && !isAtBottom()) {
        setIsAutoFollowEnabled(false);
      }
    };

    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", onScroll);
    };
  }, [isAtBottom, isAutoFollowEnabled, scrollElement]);

  useEffect(() => {
    if (!scrollElement || !isAutoFollowEnabled) return;

    const content = scrollElement.firstElementChild;
    if (!content) return;

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(contentResizeRafRef.current);
      contentResizeRafRef.current = requestAnimationFrame(() => {
        if (!isAutoFollowEnabled) return;
        scrollToBottom();
      });
    });

    observer.observe(content);
    observer.observe(scrollElement);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(contentResizeRafRef.current);
    };
  }, [isAutoFollowEnabled, scrollElement, scrollToBottom]);

  useEffect(() => {
    return () => {
      clearProgrammaticScrollGuard();
      cancelAnimationFrame(contentResizeRafRef.current);
    };
  }, [clearProgrammaticScrollGuard]);

  return {
    handleScrollContainerRef,
    isAutoFollowEnabled,
    goToLatest,
  };
}
