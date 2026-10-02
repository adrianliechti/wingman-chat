import { useLayoutEffect, useRef, useState } from "react";

/** Spread received text across a few frames; the native transcript stays immediate. */
export function useStreamingText(text: string, streaming: boolean): string {
  const [visible, setVisible] = useState(streaming ? "" : text);
  const shown = useRef(visible);
  useLayoutEffect(() => {
    if (!streaming || !text.startsWith(shown.current) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown.current = text;
      setVisible(text);
      return;
    }
    const start = shown.current.length;
    if (start === text.length) return;
    const startedAt = performance.now();
    let frame: number;
    const reveal = (now: number) => {
      // Catch up within 100 ms of the latest chunk, with no fixed typing speed
      // that could accumulate seconds of delay behind a fast response.
      const progress = Math.min(1, (now - startedAt) / 100);
      let end = start + Math.ceil((text.length - start) * progress);
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end++;
      shown.current = text.slice(0, end);
      setVisible(shown.current);
      if (end < text.length) frame = requestAnimationFrame(reveal);
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [text, streaming]);
  return streaming && text.startsWith(visible) ? visible : text;
}
