import { GEOMETRY, type Geometry, normalizeGeometry } from "./geometry";

/** Per-band hue / saturation / luminance offsets, each -100..100. */
export interface ColorMix {
  hue: number;
  saturation: number;
  luminance: number;
}

/**
 * Non-destructive edits applied on top of an image's current pixels. Every
 * value is a slider position; `DEFAULTS` renders the pixels unchanged. Keep in
 * sync with the uniforms in `gl/shaders.ts`.
 */
export interface Adjustments {
  /** Exposure in EV, -5..5. */
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  vibrance: number;
  saturation: number;
  grayscale: boolean;
  /** Eight bands in `MIXER_BANDS` order. */
  mixer: ColorMix[];
  clarity: number;
  dehaze: number;
  vignette: number;
  geometry: Geometry;
}

export const NEUTRAL_MIX: ColorMix = { hue: 0, saturation: 0, luminance: 0 };

/** HSL mixer bands: hue center in degrees plus a swatch for the panel. */
export const MIXER_BANDS = [
  { key: "red", label: "Red", hue: 0, swatch: "#ef4444" },
  { key: "orange", label: "Orange", hue: 30, swatch: "#f97316" },
  { key: "yellow", label: "Yellow", hue: 60, swatch: "#eab308" },
  { key: "green", label: "Green", hue: 120, swatch: "#22c55e" },
  { key: "aqua", label: "Aqua", hue: 180, swatch: "#06b6d4" },
  { key: "blue", label: "Blue", hue: 240, swatch: "#3b82f6" },
  { key: "purple", label: "Purple", hue: 275, swatch: "#8b5cf6" },
  { key: "magenta", label: "Magenta", hue: 315, swatch: "#ec4899" },
] as const;

export const DEFAULTS: Adjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  grayscale: false,
  mixer: MIXER_BANDS.map(() => ({ ...NEUTRAL_MIX })),
  clarity: 0,
  dehaze: 0,
  vignette: 0,
  geometry: GEOMETRY,
};

type SliderKey = {
  [K in keyof Adjustments]: Adjustments[K] extends number ? K : never;
}[keyof Adjustments];

/** Slider ranges; everything not listed is -100..100 in whole steps. */
export const SLIDER_RANGES: Partial<Record<SliderKey, { min: number; max: number; step: number }>> = {
  exposure: { min: -5, max: 5, step: 0.05 },
};

export function sliderRange(key: SliderKey) {
  return SLIDER_RANGES[key] ?? { min: -100, max: 100, step: 1 };
}

const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/**
 * Fill a stored or partial recipe up to the current shape, dropping values a
 * slider can't produce. Unknown keys are ignored, so older recipes keep
 * loading after fields are added.
 */
export function normalizeRecipe(input: unknown): Adjustments {
  const source = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof Adjustments, unknown>>;
  const slider = (key: SliderKey) => {
    const range = sliderRange(key);
    return number(source[key], DEFAULTS[key], range.min, range.max);
  };
  const mixer = Array.isArray(source.mixer) ? source.mixer : [];
  return {
    exposure: slider("exposure"),
    contrast: slider("contrast"),
    highlights: slider("highlights"),
    shadows: slider("shadows"),
    whites: slider("whites"),
    blacks: slider("blacks"),
    temperature: slider("temperature"),
    tint: slider("tint"),
    vibrance: slider("vibrance"),
    saturation: slider("saturation"),
    grayscale: source.grayscale === true,
    mixer: MIXER_BANDS.map((_, index) => {
      const band = (mixer[index] ?? {}) as Partial<Record<keyof ColorMix, unknown>>;
      return {
        hue: number(band.hue, 0, -100, 100),
        saturation: number(band.saturation, 0, -100, 100),
        luminance: number(band.luminance, 0, -100, 100),
      };
    }),
    clarity: slider("clarity"),
    dehaze: slider("dehaze"),
    vignette: slider("vignette"),
    geometry: normalizeGeometry(source.geometry),
  };
}

export function recipeEquals(a: Adjustments, b: Adjustments): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isDefaultRecipe(recipe: Adjustments): boolean {
  return recipeEquals(recipe, DEFAULTS);
}

/** True when any band of the mixer is off neutral. */
export function hasMixerEdits(recipe: Adjustments): boolean {
  return recipe.mixer.some((band) => band.hue !== 0 || band.saturation !== 0 || band.luminance !== 0);
}

/** Reset only the light/color/effects sliders, keeping crop and geometry. */
export function resetDevelop(recipe: Adjustments): Adjustments {
  return { ...DEFAULTS, geometry: recipe.geometry };
}
