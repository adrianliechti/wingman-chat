/** Pixel size of an encoded image. */
export async function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
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
