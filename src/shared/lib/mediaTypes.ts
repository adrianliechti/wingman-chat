// Single source of truth for audio/video/image file-type detection. Previously
// these lists were duplicated (and out of sync) across artifacts.ts and utils.ts.
// Extensions are lowercase, without a leading dot.

export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  "mp3",
  "wav",
  "ogg",
  "oga",
  "m4a",
  "aac",
  "flac",
  "opus",
  "weba",
]);

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  "mp4",
  "webm",
  "mov",
  "m4v",
  "ogv",
  "avi",
  "mkv",
  "wmv",
  "flv",
]);

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
  "tif",
  "tiff",
]);

/** Lowercase extension of a path/filename, or the whole string if it has no dot. */
function extOf(pathOrName: string): string {
  const name = pathOrName.split("/").pop() ?? pathOrName;
  const dot = name.lastIndexOf(".");
  return (dot >= 0 ? name.slice(dot + 1) : name).toLowerCase();
}

/** Whether a URL points at an audio file (by its path extension). */
export function isAudioUrl(url: string): boolean {
  try {
    return AUDIO_EXTENSIONS.has(extOf(new URL(url).pathname));
  } catch {
    return false;
  }
}

/** Whether a URL points at a video file (by its path extension). */
export function isVideoUrl(url: string): boolean {
  try {
    return VIDEO_EXTENSIONS.has(extOf(new URL(url).pathname));
  } catch {
    return false;
  }
}
