import { useCallback, useEffect, useState } from "react";

const STYLE_SELECTOR = 'style, link[rel="stylesheet"]';

/** Replace the PiP head's stylesheets with fresh copies of the opener's. */
function mirrorStyles(source: Document, target: Document) {
  for (const node of target.head.querySelectorAll(STYLE_SELECTOR)) node.remove();
  for (const node of source.head.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(STYLE_SELECTOR)) {
    const clone = node.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
    // Resolve against the opener: the PiP document starts as about:blank.
    if (clone instanceof HTMLLinkElement) clone.href = (node as HTMLLinkElement).href;
    target.head.appendChild(clone);
  }
}

/**
 * Open an always-on-top Document Picture-in-Picture window (Chromium 116+) and
 * keep its stylesheets and theme class in sync with this page. Render into it
 * with `createPortal(…, pipWindow.document.body)`; it shares this JS context,
 * so React state and context keep working.
 */
export function useDocumentPictureInPicture() {
  const isSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  const open = useCallback(async (options?: DocumentPictureInPictureOptions) => {
    if (!window.documentPictureInPicture) return null;
    // Only one PiP window per tab; reuse the open one.
    if (window.documentPictureInPicture.window) return window.documentPictureInPicture.window;

    const win = await window.documentPictureInPicture.requestWindow(options);
    win.document.title = document.title;
    win.addEventListener("pagehide", () => setPipWindow(null), { once: true });
    setPipWindow(win);
    return win;
  }, []);

  const close = useCallback(() => pipWindow?.close(), [pipWindow]);

  // Mirror stylesheets (Vite injects and hot-swaps <style> tags in dev) and the
  // `dark` class on <html> for as long as the window is open.
  useEffect(() => {
    if (!pipWindow) return;
    const target = pipWindow.document;

    mirrorStyles(document, target);
    target.documentElement.className = document.documentElement.className;

    const styleObserver = new MutationObserver(() => mirrorStyles(document, target));
    styleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    const classObserver = new MutationObserver(() => {
      target.documentElement.className = document.documentElement.className;
    });
    classObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      styleObserver.disconnect();
      classObserver.disconnect();
    };
  }, [pipWindow]);

  // Close the window with its owner (e.g. navigating away from the page).
  useEffect(() => () => pipWindow?.close(), [pipWindow]);

  return { isSupported, pipWindow, open, close };
}
