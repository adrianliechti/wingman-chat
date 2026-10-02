import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface UseChatScrollOptions {
  resetKey?: string | null;
  messages?: Array<{ id?: string; role: string; content?: Array<{ type: string }> }>;
  isResponding?: boolean;
}

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"]);
const TOP_CLEARANCE = 72; // matches pt-18
const BOTTOM_TOLERANCE = 2;

/** Keep a new prompt readable; Latest opts into following the rendered reply. */
export function useChatScroll({ resetKey, messages = [], isResponding = false }: UseChatScrollOptions) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const modeRef = useRef<"prompt" | "latest" | "free">("latest");
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const spacerHeightRef = useRef(0);
  const lastPromptRef = useRef<unknown>(undefined);
  const lastResetKeyRef = useRef(resetKey);
  const geometryRef = useRef({ top: 0, height: 0, viewport: 0 });

  const setSpacerHeight = useCallback((height: number) => {
    const next = Math.max(0, Math.ceil(height));
    if (next === spacerHeightRef.current) return;
    spacerHeightRef.current = next;
    if (spacerRef.current) spacerRef.current.style.height = `${next}px`;
  }, []);

  const syncScroll = useCallback(() => {
    if (!scrollElement) return;
    if (modeRef.current === "latest") {
      setSpacerHeight(0);
      scrollElement.scrollTo({ top: scrollElement.scrollHeight });
    } else {
      let target = scrollElement.scrollTop;
      if (modeRef.current === "prompt") {
        // Tool results have data-role="tool", although their message role is user.
        const prompts = scrollElement.querySelectorAll<HTMLElement>('[data-role="user"]');
        const prompt = prompts[prompts.length - 1];
        if (prompt) {
          target = Math.max(
            0,
            prompt.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + target - TOP_CLEARANCE,
          );
        }
      }
      // Retain only the space needed to hold this position. As the answer grows
      // or the reader scrolls up, reclaim it without clamping their scrollTop.
      const naturalBottom = scrollElement.scrollHeight - spacerHeightRef.current - scrollElement.clientHeight;
      setSpacerHeight(target - naturalBottom);
      scrollElement.scrollTo({ top: target });
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollElement;
    geometryRef.current = { top: scrollTop, height: scrollHeight, viewport: clientHeight };
    setIsAtBottom(scrollHeight - spacerHeightRef.current - scrollTop - clientHeight <= BOTTOM_TOLERANCE);
  }, [scrollElement, setSpacerHeight]);

  const goToLatest = useCallback(() => {
    modeRef.current = "latest";
    syncScroll();
  }, [syncScroll]);

  const handleScrollContainerRef = useCallback((element: HTMLDivElement | null) => setScrollElement(element), []);
  const handleSpacerRef = useCallback((element: HTMLDivElement | null) => {
    spacerRef.current = element;
    if (element) element.style.height = `${spacerHeightRef.current}px`;
  }, []);

  useLayoutEffect(() => {
    // A loading placeholder or tool result can already follow the new prompt
    // in the same render. Anchor to the human message itself.
    const prompt = messages.findLast(
      (message) =>
        message.role === "user" &&
        message.content?.some((part) => part.type !== "tool_result" && part.type !== "runtime_feedback"),
    );
    const identity = prompt?.id ?? prompt;
    const newPrompt = !!prompt && identity !== lastPromptRef.current;
    if (lastResetKeyRef.current !== resetKey) {
      lastResetKeyRef.current = resetKey;
      modeRef.current = newPrompt && isResponding ? "prompt" : "latest";
      setSpacerHeight(0);
    } else if (newPrompt) {
      modeRef.current = "prompt";
    }
    lastPromptRef.current = identity;
    syncScroll();
  }, [messages, resetKey, isResponding, syncScroll, setSpacerHeight]);

  useEffect(() => {
    if (!scrollElement) return;
    const release = () => {
      modeRef.current = "free";
    };
    const onGesture = (towardStart: boolean) => {
      // Scrolling down at the end (including trailing trackpad events) must not
      // silently turn following off when there is no further scroll event.
      if (towardStart || modeRef.current !== "latest") release();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) onGesture(event.deltaY < 0);
    };
    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY ?? touchY;
      if (nextY !== touchY) onGesture(nextY > touchY);
      touchY = nextY;
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (SCROLL_KEYS.has(event.key)) {
        onGesture(["ArrowUp", "PageUp", "Home"].includes(event.key) || event.shiftKey);
      }
    };
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const previous = geometryRef.current;
      const delta = scrollTop - previous.top;
      // Scrollbar dragging and accessibility scrolling do not produce wheel
      // events. Ignore movement caused by our writes or a layout clamp.
      if (Math.abs(delta) > 1 && scrollHeight === previous.height && clientHeight === previous.viewport) release();
      const atBottom = scrollHeight - spacerHeightRef.current - scrollTop - clientHeight <= BOTTOM_TOLERANCE;
      if (modeRef.current === "free" && delta > 0 && atBottom) modeRef.current = "latest";
      syncScroll();
    };
    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    scrollElement.addEventListener("wheel", onWheel, { passive: true });
    scrollElement.addEventListener("touchstart", onTouchStart, { passive: true });
    scrollElement.addEventListener("touchmove", onTouchMove, { passive: true });
    scrollElement.addEventListener("keydown", onKey);
    return () => {
      scrollElement.removeEventListener("scroll", onScroll);
      scrollElement.removeEventListener("wheel", onWheel);
      scrollElement.removeEventListener("touchstart", onTouchStart);
      scrollElement.removeEventListener("touchmove", onTouchMove);
      scrollElement.removeEventListener("keydown", onKey);
    };
  }, [scrollElement, syncScroll]);

  useLayoutEffect(() => {
    const content = scrollElement?.firstElementChild;
    if (!scrollElement || !content) return;
    // Markdown is deferred and images/math can resize after a message commit.
    // Observe actual layout as well as the scroll viewport (including its footer).
    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) return;
      // Reclaiming the spacer changes this observed box. Write next frame so
      // ResizeObserver can finish its current delivery without a resize loop.
      frame = requestAnimationFrame(() => {
        frame = undefined;
        syncScroll();
      });
    });
    observer.observe(content);
    observer.observe(scrollElement);
    syncScroll();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [scrollElement, syncScroll]);

  return { handleScrollContainerRef, handleSpacerRef, isAtBottom, goToLatest };
}
