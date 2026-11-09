import { describe, expect, it } from "vitest";
import { DEFAULTS, hasMixerEdits, isDefaultRecipe, MIXER_BANDS, normalizeRecipe, resetDevelop } from "./recipe";

describe("recipe", () => {
  it("fills a partial or legacy recipe up to the current shape", () => {
    const recipe = normalizeRecipe({ exposure: 1.25, contrast: 40, mixer: [{ hue: 20 }], unknown: true });
    expect(recipe.exposure).toBe(1.25);
    expect(recipe.contrast).toBe(40);
    expect(recipe.mixer).toHaveLength(MIXER_BANDS.length);
    expect(recipe.mixer[0]).toEqual({ hue: 20, saturation: 0, luminance: 0 });
    expect(recipe.mixer[7]).toEqual({ hue: 0, saturation: 0, luminance: 0 });
    expect(recipe.geometry).toEqual(DEFAULTS.geometry);
    expect("unknown" in recipe).toBe(false);
  });

  it("clamps out-of-range and rejects non-numeric values", () => {
    const recipe = normalizeRecipe({ exposure: 99, shadows: -500, tint: "warm", grayscale: "yes" });
    expect(recipe.exposure).toBe(5);
    expect(recipe.shadows).toBe(-100);
    expect(recipe.tint).toBe(0);
    expect(recipe.grayscale).toBe(false);
  });

  it("treats garbage as the default recipe", () => {
    expect(normalizeRecipe(null)).toEqual(DEFAULTS);
    expect(normalizeRecipe("nope")).toEqual(DEFAULTS);
    expect(isDefaultRecipe(normalizeRecipe(undefined))).toBe(true);
  });

  it("resets develop sliders but keeps the crop", () => {
    const edited = normalizeRecipe({
      exposure: 2,
      mixer: [{ saturation: 50 }],
      geometry: { crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, rotation: 1 },
    });
    expect(hasMixerEdits(edited)).toBe(true);
    const reset = resetDevelop(edited);
    expect(reset.exposure).toBe(0);
    expect(hasMixerEdits(reset)).toBe(false);
    expect(reset.geometry).toEqual(edited.geometry);
    expect(isDefaultRecipe(reset)).toBe(false);
  });
});
