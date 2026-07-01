/**
 * Renderer-option presets for notebook image generation.
 *
 * Notebook image calls used to pass no options, so every image fell back to the
 * model's defaults — square, auto quality. That's wrong for the two shapes the
 * notebook actually produces: a tall infographic poster and a landscape slide.
 * This builds the right {@link ImageRenderOptions}, gated by what the configured
 * renderer model supports (via {@link rendererCapabilities}), so unsupported
 * knobs are simply omitted rather than rejected.
 */

import type { ImageRenderOptions } from "@/shared/lib/client";
import { rendererCapabilities } from "@/shared/lib/models";

type Quality = NonNullable<ImageRenderOptions["quality"]>;
type Resolution = NonNullable<ImageRenderOptions["resolution"]>;

/** Numeric value of an "W:H" ratio (e.g. "16:9" → 1.78); 1 if unparseable. */
function ratioValue(s: string): number {
  const [w, h] = s.split(":").map(Number);
  return w && h ? w / h : 1;
}

/** Pick the supported aspect ratio numerically closest to `desired`. */
function snapAspectRatio(desired: string, supported: string[]): string {
  if (supported.includes(desired)) return desired;
  const target = ratioValue(desired);
  return supported.reduce(
    (best, cur) => (Math.abs(ratioValue(cur) - target) < Math.abs(ratioValue(best) - target) ? cur : best),
    supported[0],
  );
}

export interface ImageIntent {
  /** Desired aspect ratio, snapped to the nearest the model supports. */
  aspect: string;
  /** Desired quality tier; applied only on models that expose tiers. */
  quality: Quality;
  /** Desired output resolution; applied only when the model supports it. */
  resolution?: Resolution;
}

/**
 * Build renderer options for a notebook image, gated by model capabilities.
 * Always requests PNG so type and figures stay crisp (no JPEG ringing).
 */
export function notebookImageOptions(model: string, intent: ImageIntent): ImageRenderOptions {
  const caps = rendererCapabilities(model);
  const options: ImageRenderOptions = { format: "png" };

  options.aspectRatio = caps.aspectRatios?.length ? snapAspectRatio(intent.aspect, caps.aspectRatios) : intent.aspect;

  if (caps.qualities?.length) {
    options.quality = caps.qualities.includes(intent.quality)
      ? intent.quality
      : caps.qualities[caps.qualities.length - 1];
  }

  if (intent.resolution && caps.resolutions?.includes(intent.resolution)) {
    options.resolution = intent.resolution;
  }

  return options;
}
