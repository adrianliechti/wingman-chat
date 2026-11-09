import { svgSize } from "@/shared/lib/svg";
import type { RenderFormat } from "@/shared/types/chat";

/**
 * Pixel size of an encoded image. SVG is measured from its markup, since
 * WebKit and Firefox reject SVG blobs in createImageBitmap.
 */
export async function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  if (blob.type === "image/svg+xml") {
    const size = svgSize(await blob.text());
    if (size) return { width: Math.round(size.width), height: Math.round(size.height) };
    return decodedSize(blob);
  }
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

async function decodedSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("The image has no intrinsic size");
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Vector and animated images are shown as they are: the photo editor would
 * rasterize an SVG and freeze a GIF on its first frame.
 */
export function viewOnlyFormat(data: string, contentType?: string): RenderFormat | null {
  if (contentType === "video/mp4") return "mp4";
  const type = /^data:([^;,]+)/.exec(data)?.[1]?.toLowerCase();
  return type === "image/svg+xml" ? "svg" : type === "image/gif" ? "gif" : null;
}

export const isImageFile = (file: File) => file.type.startsWith("image/");

/** "holiday-2024.JPG" → "holiday-2024". */
export function fileTitle(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

/** First image files out of a clipboard or drop payload. */
export function imageFiles(items: DataTransferItemList | FileList | File[]): File[] {
  const files: File[] = [];
  if (items instanceof DataTransferItemList) {
    for (const item of items) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    return files;
  }
  for (const file of Array.from(items)) if (isImageFile(file)) files.push(file);
  return files;
}
