import { decodeCanvas } from "./exportImage";
import { hasSelectedPixels, type Selection, selectionToMask } from "./mask";
import { aspectRatioValue } from "./rendererOptions";
import type { Image } from "../types/canvas";
import { getConfig } from "@/shared/config";
import type { ImageRenderOptions } from "@/shared/lib/client";
import { decodeDataURL } from "@/shared/lib/utils";
import type { Model } from "@/shared/types/chat";

export type RetouchKind = "remove" | "replace" | "edit" | "removeBackground" | "replaceBackground";

export interface RetouchRequest {
  kind: RetouchKind;
  /** User text for replace / edit / replaceBackground. */
  prompt?: string;
}

/** Longest edge sent to the model; larger images are downscaled with their mask. */
export const RETOUCH_MAX_EDGE = 4096;

export const needsSelection = (kind: RetouchKind) => kind === "remove" || kind === "replace";
export const needsPrompt = (kind: RetouchKind) => kind === "replace" || kind === "edit" || kind === "replaceBackground";

/** The instruction sent to the model. */
export function retouchPrompt(request: RetouchRequest, transparent: boolean): string {
  const text = request.prompt?.trim() ?? "";
  switch (request.kind) {
    case "remove":
      return "Remove everything inside the selected area and fill it with a natural, seamless continuation of the surrounding scene. Keep everything outside the selection exactly as it is.";
    case "replace":
      return `${text}. Apply this only inside the selected area and keep the rest of the image exactly as it is.`;
    case "edit":
      return `${text}. Keep the composition, the subject and everything not mentioned unchanged.`;
    case "removeBackground":
      return transparent
        ? "Remove the background completely and keep only the main subject with clean, precise edges on a fully transparent background."
        : "Remove the background completely and keep only the main subject with clean, precise edges on a plain white background.";
    case "replaceBackground":
      return `Replace the background with ${text}. Keep the main subject exactly as it is, only adjusting its lighting so it sits naturally in the new background.`;
  }
}

/** Short description stored with the resulting version. */
export function retouchLabel(request: RetouchRequest): string {
  const text = request.prompt?.trim() ?? "";
  switch (request.kind) {
    case "remove":
      return "Removed selection";
    case "replace":
      return `Replaced selection: ${text}`;
    case "edit":
      return text;
    case "removeBackground":
      return "Removed background";
    case "replaceBackground":
      return `Background: ${text}`;
  }
}

function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image"))), "image/png");
  });
}

/** The current pixels, downscaled to the retouch limit when needed. */
async function prepareSource(image: Image): Promise<{ blob: Blob; width: number; height: number }> {
  const blob = decodeDataURL(image.data);
  // Normalize orientation, profile and encoding so the mask describes exactly
  // these PNG pixels, including legacy images without stored dimensions.
  const canvas = await decodeCanvas(blob, RETOUCH_MAX_EDGE);
  return { blob: await toBlob(canvas), width: canvas.width, height: canvas.height };
}

export interface RetouchResult {
  blob: Blob;
  prompt: string;
  label: string;
}

/**
 * Run one AI retouch through the gateway's render endpoint. The current
 * version's pixels are the image to edit; the selection (when the action uses
 * one) becomes the mask guide. Adjustments are not baked in — the recipe
 * stays on top of the result.
 */
export async function runRetouch(
  model: Model,
  image: Image,
  request: RetouchRequest,
  selection: Selection | null,
): Promise<RetouchResult> {
  const selected = selection && hasSelectedPixels(selection) ? selection : null;
  if (needsSelection(request.kind) && !selected) throw new Error("Select an area to retouch first");
  if (needsPrompt(request.kind) && !request.prompt?.trim()) throw new Error("Describe the change first");
  const transparent = !!model.supportedBackgrounds?.includes("transparent");
  const prompt = retouchPrompt(request, transparent);
  const source = await prepareSource(image);
  const options: ImageRenderOptions = {};
  const aspect = model.supportedAspectRatios?.find((value) => {
    const ratio = aspectRatioValue(value);
    return ratio !== null && Math.abs(source.width - ratio * source.height) <= 1;
  });
  if (aspect) options.aspectRatio = aspect;
  if (selected && needsSelection(request.kind)) {
    options.mask = await selectionToMask(selected, source.width, source.height);
  } else if (selected && request.kind === "replaceBackground") {
    // A selected subject is kept; only the rest may change.
    options.mask = await selectionToMask(selected, source.width, source.height, true);
  }
  if (request.kind === "removeBackground" && transparent) options.background = "transparent";
  const blob = await getConfig().client.generateImage(model.id, prompt, [source.blob], options);
  return { blob, prompt, label: retouchLabel(request) };
}
