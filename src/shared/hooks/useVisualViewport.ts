import { useEffect } from "react";

/**
 * Mirror the on-screen keyboard into CSS. iOS Safari keeps the layout viewport
 * (and every `position: fixed` box) the same size while the keyboard is up and
 * only shrinks the visual viewport, so fixed bottom chrome ends up covered.
 * `--app-keyboard` is the height of that hidden strip; the composer footer adds
 * it to its `bottom`, and `keyboard-open` drops the home-indicator inset, which
 * the keyboard already covers.
 */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      root.style.setProperty("--app-keyboard", `${Math.round(covered)}px`);
      root.classList.toggle("keyboard-open", covered > 80);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--app-keyboard");
      root.classList.remove("keyboard-open");
    };
  }, []);
}
