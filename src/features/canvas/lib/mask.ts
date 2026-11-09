import { applyMatrix } from "./geometry";

/**
 * Selections for AI retouching live on a 2D canvas in source pixel space:
 * white with alpha = coverage where selected, transparent elsewhere. The
 * gateway wants the inverse for its `mask` guide (transparent = editable),
 * which `maskPixels` produces.
 */

export interface Selection {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type SelectionTool = "brush" | "rect";
export type SelectionMode = "add" | "erase";

function context(selection: Selection): CanvasRenderingContext2D {
  const ctx = selection.canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the selection");
  return ctx;
}

export function createSelection(width: number, height: number): Selection {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return { canvas, width: canvas.width, height: canvas.height };
}

export function clearSelection(selection: Selection): void {
  context(selection).clearRect(0, 0, selection.width, selection.height);
}

export function hasSelectedPixels(selection: Selection): boolean {
  const pixels = context(selection).getImageData(0, 0, selection.width, selection.height).data;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) return true;
  return false;
}

/** Transform all four output-UV corners: a straightened screen rectangle is a source polygon. */
export function selectionRectangle(matrix: number[], width: number, height: number, a: Point, b: Point): Point[] {
  return [
    [a.x, a.y],
    [b.x, a.y],
    [b.x, b.y],
    [a.x, b.y],
  ].map(([u, v]) => {
    const [x, y] = applyMatrix(matrix, u, v);
    return { x: x * width, y: y * height };
  });
}

/** Selected becomes unselected and vice versa. */
export function invertSelection(selection: Selection): void {
  const ctx = context(selection);
  const copy = document.createElement("canvas");
  copy.width = selection.width;
  copy.height = selection.height;
  copy.getContext("2d")!.drawImage(selection.canvas, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, selection.width, selection.height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(copy, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Paint a brush stroke from `from` (or a single dab when null) to `to`. Dabs
 * are radial gradients, so feathering works everywhere without canvas filters.
 * `feather` is the fraction of the radius that fades out (0..1).
 */
export function paintStroke(
  selection: Selection,
  from: Point | null,
  to: Point,
  radius: number,
  feather: number,
  mode: SelectionMode,
): void {
  const ctx = context(selection);
  const r = Math.max(0.5, radius);
  const solid = Math.max(0, Math.min(1, 1 - feather));
  ctx.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
  const dab = (x: number, y: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(solid, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  if (!from) {
    dab(to.x, to.y);
  } else {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, r / 3)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      dab(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

export function paintRect(selection: Selection, a: Point, b: Point, mode: SelectionMode): void {
  paintPolygon(selection, [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], mode);
}

export function paintPolygon(selection: Selection, points: Point[], mode: SelectionMode): void {
  if (points.length < 3) return;
  const ctx = context(selection);
  ctx.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Turn selection coverage (RGBA, alpha = selected) into the gateway's mask
 * pixels: opaque black where the image must stay, transparent where it may
 * change. Pure so it can be unit-tested.
 */
export function maskPixels(
  coverage: Uint8ClampedArray,
  out: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(coverage.length),
): Uint8ClampedArray<ArrayBuffer> {
  for (let i = 0; i < coverage.length; i += 4) {
    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = 255 - coverage[i + 3];
  }
  return out;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the mask"))), "image/png");
  });
}

/**
 * Encode the selection as the gateway's mask PNG, scaled to the size of the
 * image being sent (`width` × `height`). `invert` masks everything except
 * the selection, e.g. to change only the background around a selected subject.
 */
export async function selectionToMask(
  selection: Selection,
  width = selection.width,
  height = selection.height,
  invert = false,
): Promise<Blob> {
  const scaled = document.createElement("canvas");
  scaled.width = width;
  scaled.height = height;
  const ctx = scaled.getContext("2d")!;
  ctx.drawImage(selection.canvas, 0, 0, width, height);
  if (invert) {
    const copy = document.createElement("canvas");
    copy.width = width;
    copy.height = height;
    copy.getContext("2d")!.drawImage(scaled, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(copy, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
  const coverage = ctx.getImageData(0, 0, width, height);
  const mask = new ImageData(maskPixels(coverage.data), width, height);
  ctx.putImageData(mask, 0, 0);
  return toBlob(scaled);
}
