import type { Image, ImageVersion } from "../types/canvas";
import { currentVersionId } from "./imageStorage";
import { DEFAULTS, normalizeRecipe, recipeEquals } from "./recipe";

export type ImagePixels = Pick<Image, "data" | "width" | "height">;

/** Older pixel-only versions and imported originals have no baked-in recipe. */
export function versionRecipe(version: ImageVersion) {
  return version.recipe ? normalizeRecipe(version.recipe) : DEFAULTS;
}

/** Reject results produced from pixels that have since been replaced. */
function checkSource(current: Image, source: Image) {
  if (currentVersionId(current) !== currentVersionId(source) || current.data !== source.data) {
    throw new Error("The image changed while this operation was running. Try again.");
  }
}

/** Publish pixels and their recipe together, including when the editor has unmounted. */
export function appendVersion(current: Image, source: Image, pixels: ImagePixels, version: ImageVersion): Image {
  checkSource(current, source);
  if (version.kind === "flatten" && !recipeEquals(current.recipe, source.recipe)) {
    throw new Error("The adjustments changed while flattening. Try again.");
  }
  const recipe = version.kind === "flatten" ? DEFAULTS : current.recipe;
  return {
    ...current,
    ...pixels,
    recipe,
    versions: [...current.versions, { ...version, recipe }],
  };
}

export function restoreImageVersion(current: Image, source: Image, versionId: string, pixels: ImagePixels): Image {
  checkSource(current, source);
  if (!recipeEquals(current.recipe, source.recipe)) {
    throw new Error("The adjustments changed while restoring. Try again.");
  }
  const index = current.versions.findIndex((version) => version.id === versionId);
  if (index < 0) throw new Error("This version is no longer available");
  const version = current.versions[index];
  return {
    ...current,
    ...pixels,
    recipe: versionRecipe(version),
    versions: current.versions.slice(0, index + 1),
  };
}
