import { describe, expect, it } from "vitest";
import { appendVersion, restoreImageVersion, versionRecipe } from "./versions";
import { DEFAULTS } from "./recipe";
import type { Image, ImageVersion } from "../types/canvas";

const original: Image = {
  id: "photo",
  data: "original",
  width: 600,
  height: 400,
  created: null,
  updated: null,
  prompt: "",
  model: "",
  versions: [{ id: "original", kind: "upload", created: "2026-01-01" }],
  recipe: {
    ...DEFAULTS,
    exposure: 1.5,
    geometry: { ...DEFAULTS.geometry, crop: { x: 0.2, y: 0, width: 0.5, height: 1 } },
  },
};
const flattened: ImageVersion = { id: "flattened", kind: "flatten", created: "2026-01-02" };
const edited: ImageVersion = { id: "edited", kind: "edit", created: "2026-01-03" };
const pixels = { data: "baked", width: 300, height: 400 };

describe("pixel version transitions", () => {
  it("flattens pixels and clears the recipe atomically while preserving the untouched original", () => {
    const result = appendVersion(original, original, pixels, flattened);
    expect(result).toMatchObject({ ...pixels, recipe: DEFAULTS });
    expect(result.versions[0]).toBe(original.versions[0]);
    expect(versionRecipe(result.versions[0])).toEqual(DEFAULTS);
    expect(result.versions[1].recipe).toEqual(DEFAULTS);
    expect(restoreImageVersion(result, result, "original", original)).toMatchObject({
      data: "original",
      width: 600,
      height: 400,
      recipe: DEFAULTS,
    });
  });

  it("restores an AI version's creation settings independently of later live edits", () => {
    const result = appendVersion(original, original, pixels, edited);
    const changed = { ...result, recipe: { ...result.recipe, exposure: 2 } };
    expect(result.versions[1].recipe).toEqual(original.recipe);
    const restored = restoreImageVersion(changed, changed, "edited", pixels);
    expect(restored.recipe).toEqual(original.recipe);
    expect(restored.versions).toHaveLength(2);
    expect(versionRecipe(restored.versions[0])).toEqual(DEFAULTS);
  });

  it("preserves live adjustments on a retouch, but rejects a flatten made with an outdated recipe", () => {
    const changed = { ...original, recipe: { ...original.recipe, exposure: 2 } };
    expect(appendVersion(changed, original, pixels, edited).recipe.exposure).toBe(2);
    expect(() => appendVersion(changed, original, pixels, flattened)).toThrow("adjustments changed");
    expect(() => restoreImageVersion(changed, original, "original", original)).toThrow("adjustments changed");
  });

  it("rejects a delayed AI result or restore after the source pixels have changed", () => {
    const current = appendVersion(original, original, pixels, flattened);
    expect(() => appendVersion(current, original, { ...pixels, data: "late" }, edited)).toThrow("image changed");
    expect(() => restoreImageVersion(current, original, "original", original)).toThrow("image changed");
  });

  it("keeps legacy versions restorable without an adjustment snapshot", () => {
    const current = { ...original, versions: [...original.versions, edited], data: "edited" };
    const restored = restoreImageVersion(current, current, "original", original);
    expect(restored.recipe).toEqual(DEFAULTS);
    expect(restored.versions).toHaveLength(1);
  });
});
