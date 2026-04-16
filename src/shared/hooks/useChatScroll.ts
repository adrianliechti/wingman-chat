import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface UseChatScrollOptions {
  resetKey?: string | null;
  messages?: Array<{ role: string }>;
  isResponding?: boolean;
}

export function useChatScroll({ resetKey, messages = [], isResponding = false }: UseChatScrollOptions) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spacerHeightRef = useRef(0);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const checkIsAtBottomRef = useRef<() => void>(() => {});
  const prevMessagesLengthRef = useRef(0);
  // Intentionally not initialized to resetKey — ensures the reset runs on
  // first mount too, so direct URL loads scroll to the bottom correctly.
  const lastResetKeyRef = useRef<string | null | undefined>(undefined);
  // Set when resetKey changes but scrollElement was null — resolved once element mounts.
  const pendingScrollToBottomRef = useRef(false);
  // Target scroll position set when a user message is sent — used to hold
  // position during streaming so behaviour matches non-streaming.
  const scrollTargetRef = useRef<number | null>(null);
  // Whether the user intentionally scrolled during the current response.
  const userScrolledDuringStreamRef = useRef(false);
  const isRespondingRef = useRef(isResponding);
  useEffect(() => {
    isRespondingRef.current = isResponding;
  }, [isResponding]);

  const setProgrammaticScroll = useCallback((durationMs: number) => {
    programmaticScrollRef.current = true;
    if (programmaticScrollTimerRef.current !== null) {
      clearTimeout(programmaticScrollTimerRef.current);
    }
    programmaticScrollTimerRef.current = setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollTimerRef.current = null;
      // Re-check position now that the lock has lifted — no scroll event fires
      // automatically after a programmatic scroll ends, so isAtBottom would
      // otherwise stay stale and the "Latest" button would never appear.
      checkIsAtBottomRef.current();
    }, durationMs);
  }, []);

  const restoreSpacer = useCallback(
    (element?: HTMLDivElement | null) => {
      const container = element ?? scrollElement;
      if (!container || !spacerRef.current) return;
      const height = container.clientHeight;
      spacerHeightRef.current = height;
      spacerRef.current.style.height = `${height}px`;
    },
    [scrollElement],
  );

  // ─── Scroll newest user message to near the top ───────────────────────────

  const scrollToNewestUserMsg = useCallback(() => {
    if (!scrollElement) return;

    restoreSpacer();

    const userMessages = scrollElement.querySelectorAll<HTMLElement>('[data-role="user"]');
    if (userMessages.length === 0) return;
    const lastUserMsg = userMessages[userMessages.length - 1];

    const containerRect = scrollElement.getBoundingClientRect();
    const msgTop = lastUserMsg.getBoundingClientRect().top - containerRect.top + scrollElement.scrollTop;
    // Clear the fixed nav bar (same as pt-18 = 72px)
    const target = Math.max(0, msgTop - 72);

    // Cache so the streaming lock can hold this position
    scrollTargetRef.current = target;
    userScrolledDuringStreamRef.current = false;

    // Use a manual rAF animation instead of scrollTo({ behavior: "smooth" }).
    // Chromium-based browsers (Edge) silently cancel native smooth scrolls when
    // scrollHeight changes significantly in the same or adjacent rendering frame
    // (which always happens here because of the spacer restore above). A manual
    // loop writes scrollTop directly every frame, so it is immune to that bug
    // while still producing the same visual easing effect.
    const DURATION = 500; // ms
    const startTop = scrollElement.scrollTop;
    const distance = target - startTop;
    const startTime = performance.now();

    setProgrammaticScroll(DURATION + 100);

    const step = (now: number) => {
      // Bail out if the programmatic lock was already cleared (e.g. a newer
      // scroll was initiated) so we don't fight with it.
      if (!programmaticScrollRef.current) return;

      const elapsed = now - startTime;
      const progress = Math.min(elapsed / DURATION, 1);
      // Ease-in-out cubic
      const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      scrollElement.scrollTop = startTop + distance * eased;

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  }, [scrollElement, restoreSpacer, setProgrammaticScroll]);

  // ─── Scroll to bottom (for "Latest" button) ───────────────────────────────

  const goToLatest = useCallback(() => {
    if (!scrollElement) return;
    if (isRespondingRef.current && spacerRef.current) {
      // During streaming: leave a partial spacer (~40 % of the viewport) so
      // the user can see new tokens appear below without immediately hitting
      // the bottom and losing context of what just arrived.
      const partialSpacer = Math.round(scrollElement.clientHeight * 0.4);
      spacerRef.current.style.height = `${partialSpacer}px`;
      spacerHeightRef.current = partialSpacer;
    } else if (spacerRef.current) {
      spacerRef.current.style.height = "0px";
      spacerHeightRef.current = 0;
    }
    scrollTargetRef.current = null;
    setProgrammaticScroll(600);
    scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: "smooth" });
  }, [scrollElement, setProgrammaticScroll]);

  // ─── Ref callbacks ────────────────────────────────────────────────────────

  const handleScrollContainerRef = useCallback((element: HTMLDivElement | null) => {
    setScrollElement(element);
    if (element) {
      if (spacerRef.current) {
        spacerRef.current.style.height = `${element.clientHeight}px`;
        spacerHeightRef.current = element.clientHeight;
      }
    }
  }, []);

  const handleSpacerRef = useCallback((element: HTMLDivElement | null) => {
    spacerRef.current = element;
  }, []);

  // ─── Keep checkIsAtBottom ref in sync with scrollElement ─────────────────

  useEffect(() => {
    checkIsAtBottomRef.current = () => {
      if (!scrollElement) return;
      const { scrollTop, clientHeight, scrollHeight } = scrollElement;
      const spacerHeight = spacerHeightRef.current;
      const visibleSpacer = Math.max(0, scrollTop + clientHeight - (scrollHeight - spacerHeight));
      const atRealBottom = scrollHeight - scrollTop - clientHeight <= 2;
      setIsAtBottom(visibleSpacer > 0 || atRealBottom);
    };
  }, [scrollElement]);

  // ─── Track scroll position for "Latest" button ───────────────────────────

  useEffect(() => {
    if (!scrollElement) return;

    const onScroll = () => {
      if (programmaticScrollRef.current) return;

      // Track whether the user manually scrolled during a streaming response
      if (isResponding) {
        userScrolledDuringStreamRef.current = true;
      }

      const { scrollTop, clientHeight, scrollHeight } = scrollElement;
      const spacerHeight = spacerHeightRef.current;

      // Collapse the portion of the spacer that's scrolled past
      const visibleSpacer = Math.max(0, scrollTop + clientHeight - (scrollHeight - spacerHeight));
      if (spacerRef.current) {
        spacerRef.current.style.height = `${visibleSpacer}px`;
        spacerHeightRef.current = visibleSpacer;
      }

      const atRealBottom = scrollHeight - scrollTop - clientHeight <= 2;
      setIsAtBottom(visibleSpacer > 0 || atRealBottom);
    };

    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollElement.removeEventListener("scroll", onScroll);
  }, [scrollElement, isResponding]);

  // ─── Initialise spacer when scroll element first mounts ──────────────────

  useEffect(() => {
    if (!scrollElement) return;
    restoreSpacer();
  }, [scrollElement, restoreSpacer]);

  // ─── Reset on chat switch ─────────────────────────────────────────────────

  useLayoutEffect(() => {
    if (lastResetKeyRef.current === resetKey) return;
    lastResetKeyRef.current = resetKey;

    setIsAtBottom(true);
    scrollTargetRef.current = null;
    userScrolledDuringStreamRef.current = false;
    if (scrollElement) {
      // Clear the spacer so we land on the actual last message, not inside it.
      if (spacerRef.current) {
        spacerRef.current.style.height = "0px";
        spacerHeightRef.current = 0;
      }
      scrollElement.scrollTop = scrollElement.scrollHeight;
    } else {
      // Container not mounted yet (e.g. switching from empty chat) — defer.
      pendingScrollToBottomRef.current = true;
    }
  }, [resetKey, scrollElement]);

  // ─── Deferred scroll-to-bottom after container mounts on chat switch ─────

  useLayoutEffect(() => {
    if (!scrollElement || !pendingScrollToBottomRef.current) return;
    pendingScrollToBottomRef.current = false;
    if (spacerRef.current) {
      spacerRef.current.style.height = "0px";
      spacerHeightRef.current = 0;
    }
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [scrollElement]);

  // ─── Scroll to user message on send ──────────────────────────────────────
  // Uses useLayoutEffect so this runs in the same synchronous pass as the
  // reset-on-chat-switch above — the correct scroll position is set before
  // the first paint, closing the gap where the message was briefly hidden.

  useLayoutEffect(() => {
    const prevLength = prevMessagesLengthRef.current;
    const currLength = messages.length;
    prevMessagesLengthRef.current = currLength;

    if (currLength <= prevLength) return;

    const lastMsg = messages[currLength - 1];
    if (lastMsg?.role === "user") {
      scrollToNewestUserMsg();
    }
  }, [messages, scrollToNewestUserMsg]);

  // ─── Re-check isAtBottom on every message update ─────────────────────────
  // The hold effect below keeps scrollTop fixed, so no scroll events fire
  // when content grows during streaming. Without this, isAtBottom stays stale
  // (true) and the "Latest" button never appears as the response streams in.

  useEffect(() => {
    if (messages.length === 0) return;
    if (programmaticScrollRef.current) return;
    checkIsAtBottomRef.current();
  }, [messages]);

  // ─── Hold scroll position during streaming ───────────────────────────────
  // Mirrors "not streaming" behaviour: scroll stays exactly where it was
  // when the user message was sent, regardless of content growing below.

  useLayoutEffect(() => {
    if (!isResponding || messages.length === 0) return;
    if (programmaticScrollRef.current) return;
    if (userScrolledDuringStreamRef.current) return;
    if (scrollTargetRef.current === null || !scrollElement) return;

    const target = scrollTargetRef.current;
    if (Math.abs(scrollElement.scrollTop - target) > 2) {
      scrollElement.scrollTop = target;
    }
  }, [messages, isResponding, scrollElement]);

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (programmaticScrollTimerRef.current !== null) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
    };
  }, []);

  return {
    handleScrollContainerRef,
    handleSpacerRef,
    isAtBottom,
    goToLatest,
  };
}
