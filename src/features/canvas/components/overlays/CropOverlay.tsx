import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { clamp, cropBounds, type Crop } from "../../lib/geometry";
import { cn } from "@/shared/lib/cn";

const HANDLES = [
  ["nw", "top left", "-top-1.5 -left-1.5 size-3 cursor-nwse-resize"],
  ["n", "top", "-top-1 left-1/2 h-2 w-7 -translate-x-1/2 cursor-ns-resize"],
  ["ne", "top right", "-top-1.5 -right-1.5 size-3 cursor-nesw-resize"],
  ["e", "right", "top-1/2 -right-1 h-7 w-2 -translate-y-1/2 cursor-ew-resize"],
  ["se", "bottom right", "-right-1.5 -bottom-1.5 size-3 cursor-nwse-resize"],
  ["s", "bottom", "-bottom-1 left-1/2 h-2 w-7 -translate-x-1/2 cursor-ns-resize"],
  ["sw", "bottom left", "-bottom-1.5 -left-1.5 size-3 cursor-nesw-resize"],
  ["w", "left", "top-1/2 -left-1 h-7 w-2 -translate-y-1/2 cursor-ew-resize"],
] as const;

const MIN = 0.02;

interface CropOverlayProps {
  crop: Crop;
  /** Locked width / height in overlay (UV) units; 0 for free. */
  ratio: number;
  /** Live change while dragging. */
  onChange: (crop: Crop) => void;
  /** Drag or key step finished. */
  onCommit: () => void;
}

/**
 * Crop frame over the stage: drag edges and corners, drag inside to move,
 * arrow keys nudge the focused handle. Coordinates are fractions of the
 * uncropped canvas the stage shows in crop mode. Ported from Aperture.
 */
export function CropOverlay({ crop, ratio, onChange, onCommit }: CropOverlayProps) {
  const c = cropBounds(crop);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; start: Crop; handle: string; width: number; height: number } | null>(
    null,
  );

  function change(start: Crop, handle: string, dx: number, dy: number) {
    if (handle === "move") {
      onChange({ ...start, x: clamp(start.x + dx, 0, 1 - start.width), y: clamp(start.y + dy, 0, 1 - start.height) });
      return;
    }
    let l = start.x;
    let r = l + start.width;
    let t = start.y;
    let b = t + start.height;
    if (handle.includes("w")) l = clamp(l + dx, 0, r - MIN);
    if (handle.includes("e")) r = clamp(r + dx, l + MIN, 1);
    if (handle.includes("n")) t = clamp(t + dy, 0, b - MIN);
    if (handle.includes("s")) b = clamp(b + dy, t + MIN, 1);
    if (ratio > 0) {
      let width = r - l;
      let height = b - t;
      const horizontal = handle.includes("e") || handle.includes("w");
      const vertical = handle.includes("n") || handle.includes("s");
      if (horizontal && (!vertical || Math.abs(dx) >= Math.abs(dy) * ratio)) height = width / ratio;
      else width = height * ratio;
      // Anchor the opposite edge (or the center line for edge handles) and
      // scale down so the locked rectangle stays inside the canvas.
      const ax = handle.includes("w")
        ? start.x + start.width
        : handle.includes("e")
          ? start.x
          : start.x + start.width / 2;
      const ay = handle.includes("n")
        ? start.y + start.height
        : handle.includes("s")
          ? start.y
          : start.y + start.height / 2;
      const maxW = horizontal ? (handle.includes("w") ? ax : 1 - ax) : 2 * Math.min(ax, 1 - ax);
      const maxH = vertical ? (handle.includes("n") ? ay : 1 - ay) : 2 * Math.min(ay, 1 - ay);
      const scale = Math.min(1, maxW / width, maxH / height);
      width *= scale;
      height *= scale;
      if (width < MIN || height < MIN) return;
      l = handle.includes("w") ? ax - width : handle.includes("e") ? ax : ax - width / 2;
      t = handle.includes("n") ? ay - height : handle.includes("s") ? ay : ay - height / 2;
      r = l + width;
      b = t + height;
    }
    onChange({ x: Math.max(0, l), y: Math.max(0, t), width: r - l, height: b - t });
  }

  function down(event: PointerEvent<HTMLElement>, handle: string) {
    if (event.button !== 0 || !root.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    const box = root.current.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, start: c, handle, width: box.width, height: box.height };
  }

  function key(event: KeyboardEvent<HTMLElement>, handle: string) {
    const step = event.shiftKey ? 0.01 : 0.002;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    event.stopPropagation();
    change(c, handle, dx, dy);
    onCommit();
  }

  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    onCommit();
  };

  return (
    <div
      ref={root}
      className="absolute inset-0 touch-none select-none"
      onPointerMove={(event) => {
        const d = drag.current;
        if (d) change(d.start, d.handle, (event.clientX - d.x) / d.width, (event.clientY - d.y) / d.height);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <div
        className="absolute shadow-[0_0_0_100vmax_rgb(0_0_0/0.55)] outline outline-1 outline-white/90"
        style={{
          left: `${c.x * 100}%`,
          top: `${c.y * 100}%`,
          width: `${c.width * 100}%`,
          height: `${c.height * 100}%`,
        }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }, (_, index) => (
            <div
              key={index}
              className={cn("border-white/35", index % 3 !== 2 && "border-r", index < 6 && "border-b")}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Move crop"
          className="absolute inset-0 cursor-move focus-visible:outline-2 focus-visible:outline-blue-400"
          onPointerDown={(event) => down(event, "move")}
          onKeyDown={(event) => key(event, "move")}
        />
        {HANDLES.map(([handle, label, className]) => (
          <button
            key={handle}
            type="button"
            aria-label={`Crop ${label}`}
            className={cn(
              "absolute rounded-sm bg-white shadow-sm ring-1 ring-black/30 focus-visible:outline-2 focus-visible:outline-blue-400",
              className,
            )}
            onPointerDown={(event) => down(event, handle)}
            onKeyDown={(event) => key(event, handle)}
          />
        ))}
      </div>
    </div>
  );
}
