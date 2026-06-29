import { useCallback, useRef, useState } from "react";

export interface DrawerResizeConfig {
  defaultWidthVw: number;
  closeThresholdPx: number;
  /** Minimum visible panel width in px while dragging (applied as clamp on setWidthVw). */
  minPanelPx?: number;
  /** Maximum panel width in px. */
  maxPanelPx?: number;
  getSiblingOffsetPx: () => number;
  setSiblingWidthVw?: (widthVw: number) => void;
  /** Minimum width in px the sibling drawer may be shrunk to during a drag. */
  siblingMinPx?: number;
  setShow: (show: boolean) => void;
  /**
   * When true, the panel is anchored at right:0 (e.g. the agent drawer).
   * Width = vw - cursor, capped so chat + siblings stay above minChatPx.
   * When false (default), the panel is offset from the right by sibling panels,
   * and width = (panelRightEdge - cursor).
   */
  anchoredAtRight?: boolean;
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
  setSiblingWidthVw,
  siblingMinPx,
  setShow,
  anchoredAtRight = false,
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

      const minChatPx = 400;

      // Track raw (unclamped) intended width for the close threshold check.
      let intendedWidthPx = (widthVw / 100) * window.innerWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const vw = window.innerWidth;
        const siblingOffset = getSiblingOffsetPx();

        let targetWidthPx: number;
        if (anchoredAtRight) {
          targetWidthPx = vw - ev.clientX;
        } else {
          const panelRightEdge = vw - siblingOffset;
          targetWidthPx = panelRightEdge - ev.clientX;
        }
        if (maxPanelPx !== undefined) targetWidthPx = Math.min(targetWidthPx, maxPanelPx);
        targetWidthPx = Math.max(0, targetWidthPx);

        const overflow = targetWidthPx + siblingOffset + minChatPx - vw;
        if (overflow > 0) {
          if (setSiblingWidthVw !== undefined && siblingMinPx !== undefined) {
            const shrinkable = Math.max(0, siblingOffset - siblingMinPx);
            const shrinkBy = Math.min(overflow, shrinkable);
            if (shrinkBy > 0) {
              setSiblingWidthVw(((siblingOffset - shrinkBy) / vw) * 100);
            }
            const remaining = overflow - shrinkBy;
            if (remaining > 0) targetWidthPx -= remaining;
          } else {
            targetWidthPx -= overflow;
          }
        }
        targetWidthPx = Math.max(0, targetWidthPx);

        intendedWidthPx = targetWidthPx;
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
    // widthVw is needed only for the initial intendedWidthPx snapshot.
    [
      widthVw,
      getSiblingOffsetPx,
      setSiblingWidthVw,
      siblingMinPx,
      maxPanelPx,
      minPanelPx,
      closeThresholdPx,
      defaultWidthVw,
      setShow,
      anchoredAtRight,
    ],
  );

  return { widthVw, setWidthVw, isResizing, handleMouseDown };
}
