import { useEffect } from "react";

/**
 * Give the shell and portaled sheets the same visible bounds. Safari can resize
 * and pan only the visual viewport; Android's resizes-content can resize both.
 * Measure the remaining bottom occlusion instead of subtracting keyboard height
 * twice. Follow Safari's pan without fighting its caret/selection scrolling.
 * Pinch zoom must not resize the app or be mistaken for a keyboard opening.
 */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    let expandedHeight = window.innerHeight;
    let layoutWidth = window.innerWidth;
    const update = () => {
      frame = 0;
      if (Math.abs(viewport.scale - 1) > 0.01) return;
      const height = Math.min(window.innerHeight, viewport.height);
      const top = Math.max(0, Math.min(viewport.offsetTop, window.innerHeight - height));
      const covered = Math.max(0, window.innerHeight - height - top);
      if (layoutWidth !== window.innerWidth) {
        layoutWidth = window.innerWidth;
        expandedHeight = window.innerHeight;
      }
      expandedHeight = Math.max(expandedHeight, window.innerHeight);
      const editing = document.activeElement?.matches(
        'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
      );
      root.style.setProperty("--app-height", `${height}px`);
      root.style.setProperty("--app-viewport-top", `${top}px`);
      root.style.setProperty("--app-keyboard", `${covered}px`);
      root.classList.toggle("keyboard-open", covered > 80 || (!!editing && expandedHeight - height > 80));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-viewport-top");
      root.style.removeProperty("--app-keyboard");
      root.classList.remove("keyboard-open");
    };
  }, []);
}
