/**
 * Crop and orientation, stored relative to the source image so a recipe keeps
 * working when the pixels are replaced by a same-sized AI edit. The math
 * follows Aperture's `geometry.ts` (quarter turns, flips, straighten, crop);
 * perspective is intentionally left out.
 */

/** Normalized crop rectangle in the rotated canvas; all zeros means "no crop". */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Geometry {
  crop: Crop;
  /** Quarter turns clockwise, 0..3. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** Straighten angle in degrees, -45..45. */
  angle: number;
}

export const NO_CROP: Crop = { x: 0, y: 0, width: 0, height: 0 };
export const FULL_CROP: Crop = { x: 0, y: 0, width: 1, height: 1 };
export const GEOMETRY: Geometry = { crop: NO_CROP, rotation: 0, flipH: false, flipV: false, angle: 0 };

export const cropBounds = (crop: Crop): Crop => (crop.width > 0 && crop.height > 0 ? crop : FULL_CROP);
export const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;

export function normalizeGeometry(input: unknown): Geometry {
  const source = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof Geometry, unknown>>;
  const crop = (source.crop && typeof source.crop === "object" ? source.crop : {}) as Partial<
    Record<keyof Crop, unknown>
  >;
  const normalized: Crop = {
    x: number(crop.x, 0, 0, 1),
    y: number(crop.y, 0, 0, 1),
    width: number(crop.width, 0, 0, 1),
    height: number(crop.height, 0, 0, 1),
  };
  const rotation = number(source.rotation, 0, 0, 3);
  return {
    crop: normalized.width > 0 && normalized.height > 0 ? normalized : NO_CROP,
    rotation: Math.round(rotation) % 4,
    flipH: source.flipH === true,
    flipV: source.flipV === true,
    angle: number(source.angle, 0, -45, 45),
  };
}

export function isDefaultGeometry(geometry: Geometry): boolean {
  return (
    geometry.crop.width === 0 &&
    geometry.crop.height === 0 &&
    geometry.rotation === 0 &&
    !geometry.flipH &&
    !geometry.flipV &&
    geometry.angle === 0
  );
}

/** Size of the (uncropped) canvas after quarter turns. */
export function canvasSize(geometry: Geometry, width: number, height: number): [number, number] {
  return geometry.rotation % 2 ? [height, width] : [width, height];
}

/** Pixel size of the rendered output: the crop applied to the rotated canvas. */
export function outputSize(geometry: Geometry, width: number, height: number): [number, number] {
  const [cw, ch] = canvasSize(geometry, width, height);
  const crop = cropBounds(geometry.crop);
  return [Math.max(1, Math.round(cw * crop.width)), Math.max(1, Math.round(ch * crop.height))];
}

/**
 * Row-major 3×3 homography mapping output UVs (0..1 over the cropped result)
 * to source-texture UVs. Rows are applied last-to-first: crop, straighten about
 * the center with the canvas aspect preserved, then flips and quarter turns.
 */
export function sourceMatrix(geometry: Geometry, width: number, height: number): number[] {
  let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const then = (a: number[]) => {
    const out = Array<number>(9).fill(0);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * m[k * 3 + c];
    m = out;
  };
  const crop = cropBounds(geometry.crop);
  const [cw, ch] = canvasSize(geometry, width, height);
  const ratio = cw / ch;
  then([crop.width, 0, crop.x, 0, crop.height, crop.y, 0, 0, 1]);
  then([2 * ratio, 0, -ratio, 0, 2, -1, 0, 0, 1]);
  const a = (geometry.angle * Math.PI) / 180;
  const co = Math.cos(a);
  const si = Math.sin(a);
  then([co, si, 0, -si, co, 0, 0, 0, 1]);
  then([1 / (2 * ratio), 0, 0.5, 0, 0.5, 0.5, 0, 0, 1]);
  if (geometry.flipH) then([-1, 0, 1, 0, 1, 0, 0, 0, 1]);
  if (geometry.flipV) then([1, 0, 0, 0, -1, 1, 0, 0, 1]);
  if (geometry.rotation === 1) then([0, 1, 0, -1, 0, 1, 0, 0, 1]);
  if (geometry.rotation === 2) then([-1, 0, 1, 0, -1, 1, 0, 0, 1]);
  if (geometry.rotation === 3) then([0, -1, 1, 1, 0, 0, 0, 0, 1]);
  return m;
}

/** Map an output UV through the matrix (same math as the finish shader). */
export function applyMatrix(m: number[], u: number, v: number): [number, number] {
  const d = m[6] * u + m[7] * v + m[8];
  return [(m[0] * u + m[1] * v + m[2]) / d, (m[3] * u + m[4] * v + m[5]) / d];
}

/** Shrink a crop to the given width/height ratio around its center. */
export function fitAspect(crop: Crop, ratio: number): Crop {
  if (!ratio) return crop;
  let width = crop.width;
  let height = crop.height;
  if (width / height > ratio) width = height * ratio;
  else height = width / ratio;
  return { x: crop.x + (crop.width - width) / 2, y: crop.y + (crop.height - height) / 2, width, height };
}

/**
 * Turn the picture a quarter turn (+1 clockwise, -1 counter-clockwise). The
 * crop is re-expressed in the turned canvas so the framing only rotates.
 */
export function rotateGeometry(geometry: Geometry, direction: 1 | -1): Geometry {
  const c = cropBounds(geometry.crop);
  const cropped = geometry.crop.width > 0 && geometry.crop.height > 0;
  const crop =
    direction > 0
      ? { x: 1 - c.y - c.height, y: c.x, width: c.height, height: c.width }
      : { x: c.y, y: 1 - c.x - c.width, width: c.height, height: c.width };
  return {
    ...geometry,
    rotation: (geometry.rotation + direction + 4) % 4,
    flipH: geometry.flipV,
    flipV: geometry.flipH,
    crop: cropped ? { ...crop, x: Math.max(0, crop.x), y: Math.max(0, crop.y) } : NO_CROP,
  };
}

/** Mirror the picture; the crop mirrors with it and the straighten angle flips sign. */
export function flipGeometry(geometry: Geometry, axis: "horizontal" | "vertical"): Geometry {
  const c = cropBounds(geometry.crop);
  const cropped = geometry.crop.width > 0 && geometry.crop.height > 0;
  if (axis === "horizontal") {
    return {
      ...geometry,
      flipH: !geometry.flipH,
      angle: -geometry.angle,
      crop: cropped ? { ...c, x: Math.max(0, 1 - c.x - c.width) } : NO_CROP,
    };
  }
  return {
    ...geometry,
    flipV: !geometry.flipV,
    angle: -geometry.angle,
    crop: cropped ? { ...c, y: Math.max(0, 1 - c.y - c.height) } : NO_CROP,
  };
}

/** Width / height of the crop in canvas pixels. */
export function cropPixelRatio(geometry: Geometry, width: number, height: number): number {
  const [cw, ch] = canvasSize(geometry, width, height);
  const c = cropBounds(geometry.crop);
  return (c.width * cw) / (c.height * ch);
}

/**
 * The largest centered crop with the given canvas-space ratio (0 keeps the
 * current ratio) that stays inside a canvas straightened by `angle` degrees.
 * `ratio` is width / height of the crop in canvas pixels; the canvas is
 * `cw × ch`. Returns normalized coordinates.
 */
export function largestCrop(angle: number, cw: number, ch: number, ratio = cw / ch): Crop {
  const a = Math.abs((angle * Math.PI) / 180);
  const co = Math.cos(a);
  const si = Math.sin(a);
  // A w×h rectangle rotated by `a` must fit: w·cos + h·sin <= cw, w·sin + h·cos <= ch.
  const w = Math.min(cw / (co + si / ratio), ch / (si + co / ratio));
  const h = w / ratio;
  const width = clamp(w / cw, 0, 1);
  const height = clamp(h / ch, 0, 1);
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}
