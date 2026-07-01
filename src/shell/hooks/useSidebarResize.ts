import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "app_sidebar_width";
/** Matches the original `md:w-56` (14rem). */
const DEFAULT_WIDTH = 224;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
/** Matches the sidebar's `md:left-2` inset, so width tracks the cursor 1:1. */
const LEFT_OFFSET = 8;

const clamp = (px: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px));

interface SidebarResizeReturn {
  width: number;
  isResizing: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
  resetWidth: () => void;
}

/**
 * Drives the resizable left sidebar. Width is persisted to localStorage and
 * exposed in px; AppLayout applies it as an inline width on the sidebar and a
 * matching margin offset on the content/nav, and the chat input footer offsets
 * by it too, so everything follows the drag. Mirrors the right-side drawer
 * resize pattern (see useDrawerResize) but anchored to the left edge.
 */
export function useSidebarResize(): SidebarResizeReturn {
  const [width, setWidth] = useState(() => {
    // Number(null) / Number("abc") are falsy → fall back to the default.
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return stored ? clamp(stored) : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    document.body.classList.add("resizing");

    const onMouseMove = (ev: MouseEvent) => setWidth(clamp(ev.clientX - LEFT_OFFSET));
    const onMouseUp = () => {
      setIsResizing(false);
      document.body.classList.remove("resizing");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  const resetWidth = useCallback(() => setWidth(DEFAULT_WIDTH), []);

  return { width, isResizing, handleMouseDown, resetWidth };
}
