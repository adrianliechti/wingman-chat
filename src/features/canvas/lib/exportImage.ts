import { ImageRenderer } from "./gl/renderer";
import type { Adjustments } from "./recipe";

export type ExportFormat = "png" | "jpeg" | "webp";

export const EXPORT_FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  { value: "png", label: "PNG", description: "Lossless, keeps transparency" },
  { value: "jpeg", label: "JPEG", description: "Smaller, for photos" },
  { value: "webp", label: "WebP", description: "Small, keeps transparency" },
];

/** Longest edge of the interactive preview texture; export always uses full resolution. */
export const PREVIEW_MAX_EDGE = 2048;

function createCanvas(width = 1, height = 1): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Color-manage into the shader's sRGB working space, optionally downscaling. */
async function bitmapViaCanvas(full: ImageBitmap, width: number, height: number): Promise<ImageBitmap> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d", { colorSpace: "srgb" }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!context) throw new Error("Could not prepare the image");
  context.imageSmoothingQuality = "high";
  context.drawImage(full, 0, 0, width, height);
  return createImageBitmap(canvas, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

/**
 * `createImageBitmap(blob)` is strict about the blob's MIME type in some
 * engines; an <img> sniffs the bytes instead, so it is the fallback decoder.
 */
function decodeViaElement(blob: Blob): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const element = document.createElement("img");
    element.onload = () => {
      URL.revokeObjectURL(url);
      createImageBitmap(element).then(resolve, reject);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The image could not be decoded"));
    };
    element.src = url;
  });
}

async function decodeFull(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    if (typeof document === "undefined") throw error;
    return decodeViaElement(blob);
  }
}

/** Decode to straight-alpha sRGB, optionally limiting the longest edge. */
export async function decodeBitmap(blob: Blob, maxEdge?: number): Promise<ImageBitmap> {
  const full = await decodeFull(blob);
  try {
    // ImageBitmap can retain its embedded profile (notably in WebKit), while
    // WebGL bitmap uploads ignore UNPACK_COLORSPACE_CONVERSION_WEBGL. Explicit
    // canvas conversion makes JPEG/PNG profiles agree with normal image display.
    const scale = maxEdge && maxEdge > 0 ? Math.min(1, maxEdge / Math.max(full.width, full.height)) : 1;
    return await bitmapViaCanvas(
      full,
      Math.max(1, Math.round(full.width * scale)),
      Math.max(1, Math.round(full.height * scale)),
    );
  } finally {
    full.close();
  }
}

function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))), type, quality);
  });
}

/**
 * Bake `recipe` into `source` at full resolution. JPEG has no alpha, so
 * transparent pixels are flattened onto white.
 */
export async function renderExport(
  source: Blob,
  recipe: Adjustments,
  format: ExportFormat,
  { quality = 0.92 }: { quality?: number } = {},
): Promise<Blob> {
  const bitmap = await decodeBitmap(source);
  const canvas = createCanvas();
  let renderer: ImageRenderer | undefined;
  try {
    renderer = new ImageRenderer(canvas, { preserveDrawingBuffer: true });
    renderer.setSource(bitmap);
    renderer.draw(recipe, { matte: format === "jpeg" ? [1, 1, 1] : null });
    const blob = await toBlob(canvas, `image/${format}`, quality);
    // Canvas encoders silently return PNG for unsupported MIME types.
    if (blob.type !== `image/${format}`) {
      throw new Error(`This browser cannot export ${format.toUpperCase()}. Choose PNG or JPEG.`);
    }
    return blob;
  } finally {
    renderer?.destroy({ loseContext: true });
    bitmap.close();
  }
}

/** Filesystem-safe name from a title or prompt, e.g. "misty-forest-at-dawn.png". */
export function exportFilename(base: string | undefined, format: ExportFormat): string {
  const slug = (base ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .slice(0, 60)
    .replace(/-+$/g, "");
  const extension = format === "jpeg" ? "jpg" : format;
  return `${slug || "image"}.${extension}`;
}
