import { useLayoutEffect } from "react";
import { findTextRanges } from "@/shared/lib/textSearch";

/** Recompute highlights as deferred Markdown renders; keep normal manual scrolling available. */
export function useSearchMessage(
  container: HTMLElement | null,
  messageId: string | undefined,
  query: string | undefined,
  navigationKey: string | undefined,
  goToTarget: (resolve: () => HTMLElement | Range | null) => void,
) {
  useLayoutEffect(() => {
    if (!container || !messageId) return;
    let element: HTMLElement | null = null;
    let ranges: Range[] = [];
    let jumped = false;
    let foundPassage = false;
    const highlightName = "chat-search";
    const update = () => {
      element = container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
      if (!element) return;
      ranges = query ? findTextRanges(element, query) : [];
      if (typeof Highlight !== "undefined" && CSS.highlights) {
        CSS.highlights.set(highlightName, new Highlight(...ranges));
      }
      // First anchor to the message, then its matching passage once Markdown is ready.
      if (!jumped || (!foundPassage && ranges.length > 0)) {
        goToTarget(() => {
          const range = ranges[0];
          if (!range || !element) return element;
          // Near the start, reveal the whole message below the bar.
          // Deep inside a long reply, reveal the matching passage itself.
          return range.getBoundingClientRect().top - element.getBoundingClientRect().top < 64 ? element : range;
        });
        jumped = true;
        foundPassage = ranges.length > 0;
      }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(container, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete(highlightName);
    };
  }, [container, messageId, query, navigationKey, goToTarget]);
}
