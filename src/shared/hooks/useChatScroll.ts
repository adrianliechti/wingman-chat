import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface UseChatScrollOptions {
  resetKey?: string | null;
  messages?: Array<{ role: string; content?: Array<{ type: string }> }>;
  isResponding?: boolean;
}

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"]);
const TOP_CLEARANCE = 72; // matches pt-18

/**
 * Sending pins the latest user message just below the top nav and holds it there
 * while the answer streams in below; released as soon as the user scrolls.
 */
export function useChatScroll({ resetKey, messages = [], isResponding = false }: UseChatScrollOptions) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const spacerRef = useRef<HTMLDivElement | null>(null);
  const spacerHeightRef = useRef(0);
  const pinnedRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const lastSeenMsgRef = useRef<unknown>(undefined);
  const pinResetKeyRef = useRef<string | null | undefined>(undefined);
  const lastResetKeyRef = useRef<string | null | undefined>(undefined);
  const pendingScrollToBottomRef = useRef(false);

  const setSpacerHeight = useCallback((height: number) => {
    const h = Math.max(0, Math.round(height));
    spacerHeightRef.current = h;
    if (spacerRef.current) spacerRef.current.style.height = `${h}px`;
  }, []);

  // scrollTop that puts the last prompt below the nav. Tool results are also
  // role "user", but carry data-role="tool", so they don't match here.
  const pinTarget = useCallback(() => {
    if (!scrollElement) return null;
    const prompts = scrollElement.querySelectorAll<HTMLElement>('[data-role="user"]');
    const el = prompts[prompts.length - 1];
    if (!el) return null;
    const top = el.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
    return Math.max(0, top - TOP_CLEARANCE);
  }, [scrollElement]);

  const checkIsAtBottom = useCallback(() => {
    if (!scrollElement) return;
    const { scrollTop, clientHeight, scrollHeight } = scrollElement;
    const visibleSpacer = scrollTop + clientHeight - (scrollHeight - spacerHeightRef.current);
    setIsAtBottom(visibleSpacer > 0 || scrollHeight - scrollTop - clientHeight <= 2);
  }, [scrollElement]);

  const maintainPin = useCallback(() => {
    if (!scrollElement || !pinnedRef.current || programmaticScrollRef.current) return;
    const target = pinTarget();
    if (target != null && Math.abs(scrollElement.scrollTop - target) > 1) scrollElement.scrollTop = target;
  }, [scrollElement, pinTarget]);

  // Manual rAF: Chromium cancels native smooth scroll when scrollHeight changes
  // mid-animation, which happens constantly while streaming.
  const animateScrollTo = useCallback(
    (target: number) => {
      if (!scrollElement) return;
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      programmaticScrollRef.current = true;
      const start = scrollElement.scrollTop;
      const distance = target - start;
      const startTime = performance.now();
      const step = (now: number) => {
        if (!scrollElement) return;
        const p = Math.min((now - startTime) / 450, 1);
        const eased = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
        scrollElement.scrollTop = start + distance * eased;
        if (p < 1) {
          animationRef.current = requestAnimationFrame(step);
        } else {
          animationRef.current = null;
          programmaticScrollRef.current = false;
          checkIsAtBottom();
        }
      };
      animationRef.current = requestAnimationFrame(step);
    },
    [scrollElement, checkIsAtBottom],
  );

  const pinToTop = useCallback(
    (smooth: boolean) => {
      if (!scrollElement) return;
      pinnedRef.current = true;
      setSpacerHeight(scrollElement.clientHeight);
      const target = pinTarget();
      if (target == null) return;
      if (smooth) animateScrollTo(target);
      else scrollElement.scrollTop = target;
    },
    [scrollElement, setSpacerHeight, pinTarget, animateScrollTo],
  );

  const goToLatest = useCallback(() => {
    if (!scrollElement) return;
    pinnedRef.current = false;
    setSpacerHeight(isResponding ? scrollElement.clientHeight * 0.4 : 0);
    animateScrollTo(scrollElement.scrollHeight - scrollElement.clientHeight);
  }, [scrollElement, isResponding, setSpacerHeight, animateScrollTo]);

  const handleScrollContainerRef = useCallback((el: HTMLDivElement | null) => setScrollElement(el), []);
  const handleSpacerRef = useCallback((el: HTMLDivElement | null) => {
    spacerRef.current = el;
  }, []);

  // Reclaim the spacer only while unpinned: shrinking it while pinned tightens
  // maxScroll until a tool collapse clamps scrollTop and nudges the view up.
  useEffect(() => {
    if (!scrollElement) return;
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      if (!pinnedRef.current) {
        const { scrollTop, clientHeight, scrollHeight } = scrollElement;
        const spacerHeight = spacerHeightRef.current;
        const visible = Math.max(0, Math.min(spacerHeight, scrollTop + clientHeight - (scrollHeight - spacerHeight)));
        if (visible !== spacerHeight) setSpacerHeight(visible);
      }
      checkIsAtBottom();
    };
    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollElement.removeEventListener("scroll", onScroll);
  }, [scrollElement, setSpacerHeight, checkIsAtBottom]);

  // Release the pin on a real gesture — not scroll events, which our own writes fire.
  useEffect(() => {
    if (!scrollElement) return;
    const unpin = () => {
      pinnedRef.current = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) pinnedRef.current = false;
    };
    scrollElement.addEventListener("wheel", unpin, { passive: true });
    scrollElement.addEventListener("touchmove", unpin, { passive: true });
    scrollElement.addEventListener("keydown", onKey);
    return () => {
      scrollElement.removeEventListener("wheel", unpin);
      scrollElement.removeEventListener("touchmove", unpin);
      scrollElement.removeEventListener("keydown", onKey);
    };
  }, [scrollElement]);

  // The pin holds scrollTop steady, so no scroll events fire as content grows.
  useEffect(() => {
    if (messages.length === 0 || programmaticScrollRef.current) return;
    checkIsAtBottom();
  }, [messages, checkIsAtBottom]);

  // Reset to the bottom on chat switch, deferring the scroll until the container
  // is mounted.
  useLayoutEffect(() => {
    if (lastResetKeyRef.current !== resetKey) {
      lastResetKeyRef.current = resetKey;
      pinnedRef.current = false;
      setIsAtBottom(true);
      pendingScrollToBottomRef.current = true;
    }
    if (!scrollElement || !pendingScrollToBottomRef.current) return;
    pendingScrollToBottomRef.current = false;
    setSpacerHeight(0);
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [resetKey, scrollElement, setSpacerHeight]);

  // Pin the newest message on send/edit, detected by reference (edits truncate,
  // so a length check misses them); skipped on chat switch. Only genuine prompts
  // anchor — tool results are role "user" too, but carry no text content.
  useLayoutEffect(() => {
    const last = messages[messages.length - 1];
    const prevLast = lastSeenMsgRef.current;
    const switched = pinResetKeyRef.current !== resetKey;
    lastSeenMsgRef.current = last;
    pinResetKeyRef.current = resetKey;
    if (switched || !last || last === prevLast) return;
    if (last.role === "user" && last.content?.some((p) => p.type !== "tool_result")) pinToTop(true);
  }, [messages, resetKey, pinToTop]);

  // Hold the pin: synchronously per render (steady as tool calls run) and on
  // non-render reflows (images, fonts) via ResizeObserver.
  useLayoutEffect(() => {
    if (messages.length > 0) maintainPin();
  }, [messages, maintainPin]);

  useEffect(() => {
    const content = scrollElement?.firstElementChild;
    if (!content) return;
    const observer = new ResizeObserver(maintainPin);
    observer.observe(content);
    window.addEventListener("resize", maintainPin);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", maintainPin);
    };
  }, [scrollElement, maintainPin]);

  useEffect(
    () => () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    },
    [],
  );

  return { handleScrollContainerRef, handleSpacerRef, isAtBottom, goToLatest };
}
