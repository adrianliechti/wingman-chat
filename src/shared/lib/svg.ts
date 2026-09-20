/**
 * Main-thread SVG rasterization. Workers cannot decode SVG — WebKit and
 * Firefox reject SVG blobs in createImageBitmap — so the interpreter workers
 * bridge here and render through an HTMLImageElement.
 */

import { withAbort } from "./abortSignals";

export interface SvgRasterizeOptions {
  signal?: AbortSignal;
  width?: number;
  height?: number;
}

export async function rasterizeSvg(svg: string, options?: SvgRasterizeOptions): Promise<Uint8Array> {
  const signal = options?.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    await withAbort(
      signal,
      () =>
        new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("rasterizeSvg: failed to decode SVG"));
          image.src = url;
        }),
    );
    // naturalWidth/Height are 0 when the SVG has no intrinsic size (e.g. only
    // a viewBox); fall back to the viewBox dimensions in that case.
    const fallback = image.naturalWidth ? undefined : viewBoxSize(svg);
    const width = Math.round(options?.width ?? (image.naturalWidth || fallback?.width || 300));
    const height = Math.round(options?.height ?? (image.naturalHeight || fallback?.height || 150));
    if (!Number.isFinite(width * height) || width <= 0 || height <= 0 || width * height > 8_000_000) {
      throw new Error("rasterizeSvg: image dimensions must fit within 8 million pixels.");
    }
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("rasterizeSvg: 2D canvas context unavailable");
    context.drawImage(image, 0, 0, width, height);
    const blob = await withAbort(
      signal,
      () => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png")),
    );
    if (!blob) throw new Error("rasterizeSvg: PNG encoding failed");
    return new Uint8Array(await withAbort(signal, () => blob.arrayBuffer()));
  } finally {
    image.onload = image.onerror = null;
    image.src = "";
    canvas.width = canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}

function viewBoxSize(svg: string): { width: number; height: number } | undefined {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const viewBox = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length !== 4 || !viewBox[2] || !viewBox[3]) return undefined;
  return { width: viewBox[2], height: viewBox[3] };
}
