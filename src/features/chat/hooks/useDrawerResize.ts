import { useCallback, useRef, useState } from "react";

export interface DrawerResizeConfig {
  defaultWidthVw: number;
  closeThresholdPx: number;
  /** Minimum visible panel width in px while dragging (applied as clamp on setWidthVw). */
  minPanelPx?: number;
  /** Maximum panel width in px. */
  maxPanelPx?: number;
  /**
   * Called once at drag-start to snapshot the combined sibling-drawer offset.
   * Using a callback instead of a value prevents stale-closure drift if sibling
   * state changes between renders but before the drag begins.
   */
  getSiblingOffsetPx: () => number;
  setShow: (show: boolean) => void;
}

export interface DrawerResizeReturn {
  widthVw: number;
  setWidthVw: React.Dispatch<React.SetStateAction<number>>;
  isResizing: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
}

export function useDrawerResize({
  defaultWidthVw,
  closeThresholdPx,
  minPanelPx,
  maxPanelPx,
  getSiblingOffsetPx,
  setShow,
}: DrawerResizeConfig): DrawerResizeReturn {
  const [widthVw, setWidthVw] = useState(defaultWidthVw);
  const [isResizing, setIsResizing] = useState(false);
  const resizingRef = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      setIsResizing(true);
      document.body.classList.add("resizing");

      // Snapshot sibling offset at drag-start — won't drift during the drag.
      const siblingOffset = getSiblingOffsetPx();
      const minChatPx = 400;

      // Track raw (unclamped) intended width for the close threshold check.
      let intendedWidthPx = (widthVw / 100) * window.innerWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const vw = window.innerWidth;
        const panelRightEdge = vw - siblingOffset;
        let targetWidthPx = Math.min(panelRightEdge - minChatPx, panelRightEdge - ev.clientX);
        if (maxPanelPx !== undefined) targetWidthPx = Math.min(targetWidthPx, maxPanelPx);
        intendedWidthPx = Math.max(0, targetWidthPx);
        const visibleWidthPx = minPanelPx !== undefined ? Math.max(minPanelPx, intendedWidthPx) : intendedWidthPx;
        setWidthVw((visibleWidthPx / vw) * 100);
      };

      const onMouseUp = () => {
        resizingRef.current = false;
        setIsResizing(false);
        document.body.classList.remove("resizing");
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        if (intendedWidthPx < closeThresholdPx) {
          setShow(false);
          setTimeout(() => setWidthVw(defaultWidthVw), 300);
        }
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    // widthVw is needed only for the initial intendedWidthPx snapshot;
    // getSiblingOffsetPx is called fresh each drag so it stays current.
    [widthVw, getSiblingOffsetPx, maxPanelPx, minPanelPx, closeThresholdPx, defaultWidthVw, setShow],
  );

  return { widthVw, setWidthVw, isResizing, handleMouseDown };
}
