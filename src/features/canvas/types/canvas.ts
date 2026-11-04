import type { Adjustments } from "../lib/recipe";

export type { Adjustments };

/** How a version's pixels came to be. */
export type VersionKind = "generated" | "upload" | "edit" | "flatten";

/** One set of pixels in an image's history; the last entry is the current one. */
export interface ImageVersion {
  id: string;
  kind: VersionKind;
  prompt?: string;
  model?: string;
  created: string;
}

export interface Image {
  id: string;
  title?: string;

  created: Date | null;
  updated: Date | null;

  /** Model and prompt that produced the current version ("" for opened photos). */
  model: string;
  prompt: string;

  /** Data URL of the current version's pixels (e.g. "data:image/png;base64,..."). */
  data: string;
  width?: number;
  height?: number;

  /** Pixel history, oldest first; the last entry is `data`. */
  versions: ImageVersion[];
  /** Non-destructive edits rendered on top of `data`. */
  recipe: Adjustments;
}
