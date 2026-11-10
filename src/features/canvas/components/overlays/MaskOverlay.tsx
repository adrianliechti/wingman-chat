import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { applyMatrix } from "../../lib/geometry";
import {
  paintPolygon,
  paintStroke,
  selectionRectangle,
  type Point,
  type Selection,
  type SelectionMode,
  type SelectionTool,
} from "../../lib/mask";
import { cn } from "@/shared/lib/cn";

interface MaskOverlayProps {
  selection: Selection;
  /** Bumped by the owner whenever the selection changed outside a stroke (clear, invert). */
  revision: number;
  tool: SelectionTool;
  mode: SelectionMode;
  /** Brush diameter in screen pixels. */
  size: number;
  /** Feather 0..100 (percent of the radius). */
  feather: number;
  /** Output UV → source UV for the current geometry. */
  matrix: number[];
  /** Rendered output size in pixels at full resolution. */
  output: [number, number];
  disabled?: boolean;
  /** A stroke or rectangle was added. */
  onStroke: () => void;
}

const TINT = "rgba(59, 130, 246, 0.5)";

/**
 * Paints a selection onto the source-space canvas while the stage shows the
 * cropped, rotated image. Pointer positions go through the geometry matrix, so
 * strokes land on the right source pixels; the preview draws the selection back
 * through the inverse transform.
 */
export function MaskOverlay({
  selection,
  revision,
  tool,
  mode,
  size,
  feather,
  matrix,
  output,
  disabled,
  onStroke,
}: MaskOverlayProps) {
  const root = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ last: Point; start: Point; current: Point } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  /** Screen position (relative to the overlay) → source pixel. */
  const toSource = useCallback(
    (x: number, y: number, box: DOMRect): Point => {
      const [u, v] = applyMatrix(matrix, x / box.width, y / box.height);
      return { x: u * selection.width, y: v * selection.height };
    },
    [matrix, selection.width, selection.height],
  );

  const redraw = useCallback(() => {
    const canvas = preview.current;
    const element = root.current;
    if (!canvas || !element) return;
    const box = element.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(box.width * dpr));
    const height = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx || !box.width || !box.height) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Screen → source is affine for crop/turn/flip/straighten; invert it to
    // draw the source-space selection where it appears on screen.
    const o = toSource(0, 0, box);
    const px = toSource(1, 0, box);
    const py = toSource(0, 1, box);
    const a = px.x - o.x;
    const b = px.y - o.y;
    const c = py.x - o.x;
    const d = py.y - o.y;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-12) return;
    const ia = d / det;
    const ib = -b / det;
    const ic = -c / det;
    const id = a / det;
    const ie = -(ia * o.x + ic * o.y);
    const iff = -(ib * o.x + id * o.y);
    ctx.setTransform(ia * dpr, ib * dpr, ic * dpr, id * dpr, ie * dpr, iff * dpr);
    ctx.drawImage(selection.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = TINT;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";

    const live = drag.current;
    if (tool === "rect" && live) {
      // Rectangle in progress: dashed outline in screen space.
      const s = { x: live.start.x * width, y: live.start.y * height };
      const e = { x: live.current.x * width, y: live.current.y * height };
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.strokeRect(Math.min(s.x, e.x), Math.min(s.y, e.y), Math.abs(e.x - s.x), Math.abs(e.y - s.y));
      ctx.setLineDash([]);
    }
    const cursor = pointer.current;
    if (tool === "brush" && cursor && !disabled) {
      ctx.beginPath();
      ctx.arc(cursor.x * dpr, cursor.y * dpr, (size / 2) * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = mode === "erase" ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.95)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.75 * dpr;
      ctx.stroke();
    }
  }, [toSource, selection.canvas, tool, mode, size, disabled]);

  useEffect(() => {
    redraw();
  }, [redraw, revision]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(element);
    return () => observer.disconnect();
  }, [redraw]);

  const local = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, box };
  };

  /** Brush radius in source pixels: screen radius scaled to output pixels (1:1 with source). */
  const sourceRadius = (box: DOMRect) => (size / 2) * (output[0] / box.width);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y, box } = local(event);
    const point = toSource(x, y, box);
    const uv = { x: x / box.width, y: y / box.height };
    drag.current = { last: point, start: uv, current: uv };
    if (tool === "brush") paintStroke(selection, null, point, sourceRadius(box), feather / 100, mode);
    pointer.current = { x, y };
    redraw();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const { x, y, box } = local(event);
    pointer.current = { x, y };
    const live = drag.current;
    if (live && !disabled) {
      const point = toSource(x, y, box);
      if (tool === "brush") {
        paintStroke(selection, live.last, point, sourceRadius(box), feather / 100, mode);
        live.last = point;
      } else {
        live.current = { x: x / box.width, y: y / box.height };
      }
    }
    redraw();
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const live = drag.current;
    drag.current = null;
    if (!live || disabled) return;
    if (tool === "rect") {
      const { x, y, box } = local(event);
      paintPolygon(
        selection,
        selectionRectangle(matrix, selection.width, selection.height, live.start, {
          x: x / box.width,
          y: y / box.height,
        }),
        mode,
      );
    }
    redraw();
    onStroke();
  };

  return (
    <div
      ref={root}
      role="img"
      aria-label="Selection"
      className={cn(
        "absolute inset-0 touch-none select-none",
        disabled ? "cursor-not-allowed" : tool === "brush" ? "cursor-none" : "cursor-crosshair",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={() => {
        pointer.current = null;
        redraw();
      }}
    >
      <canvas ref={preview} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
    </div>
  );
}
