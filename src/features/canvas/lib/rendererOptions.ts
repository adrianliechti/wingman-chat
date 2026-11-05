import type { ImageBackground, ImageQuality, ImageResolution, Model } from "@/shared/types/chat";
import type { SubmenuConfig } from "@/shared/ui/ModelDropdown";

/** Aspect-ratio option metadata; only those the selected model supports are shown. */
export const ASPECT_OPTIONS = [
  { value: "1:1", label: "1:1", description: "Square" },
  { value: "4:3", label: "4:3", description: "Landscape" },
  { value: "3:2", label: "3:2", description: "Photo" },
  { value: "16:9", label: "16:9", description: "Widescreen" },
  { value: "21:9", label: "21:9", description: "Cinematic" },
  { value: "5:4", label: "5:4", description: "Print" },
  { value: "4:5", label: "4:5", description: "Social" },
  { value: "3:4", label: "3:4", description: "Portrait" },
  { value: "2:3", label: "2:3", description: "Photo (tall)" },
  { value: "9:16", label: "9:16", description: "Vertical" },
];

export const QUALITY_OPTIONS: { value: ImageQuality; label: string; description: string }[] = [
  { value: "low", label: "Low", description: "Fastest, lower detail" },
  { value: "medium", label: "Medium", description: "Balanced" },
  { value: "high", label: "High", description: "More detail, slower" },
  { value: "xhigh", label: "Extra high", description: "Extra detail, higher cost" },
  { value: "max", label: "Max", description: "Maximum quality, highest cost" },
];

export const RESOLUTION_OPTIONS: { value: ImageResolution; label: string; description: string }[] = [
  { value: "512", label: "512", description: "Small and fast" },
  { value: "1K", label: "1K", description: "Standard size" },
  { value: "2K", label: "2K", description: "Sharper, slower" },
  { value: "4K", label: "4K", description: "Highest, slowest" },
];

export const BACKGROUND_OPTIONS: { value: ImageBackground; label: string; description: string }[] = [
  { value: "opaque", label: "Opaque", description: "Solid background" },
  { value: "transparent", label: "Transparent", description: "Cut-out, no background" },
];

/** Numeric width / height for an aspect like "16:9"; null when unparsable. */
export function aspectRatioValue(aspect: string | null | undefined): number | null {
  if (!aspect) return null;
  const [w, h] = aspect.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : null;
}

export interface RenderSelection {
  aspect: string | null;
  quality: ImageQuality | null;
  resolution: ImageResolution | null;
  background: ImageBackground | null;
}

export const EMPTY_SELECTION: RenderSelection = { aspect: null, quality: null, resolution: null, background: null };

/** Drop selections the model can't honor so we never send an option it ignores. */
export function constrainSelection(model: Model | null, selection: RenderSelection): RenderSelection {
  if (!model) return selection;
  const keep = <T extends string>(value: T | null, supported?: readonly T[]) =>
    value && supported?.includes(value) ? value : null;
  return {
    aspect: keep(selection.aspect, model.supportedAspectRatios),
    quality: keep(selection.quality, model.supportedQualities),
    resolution: keep(selection.resolution, model.supportedResolutions),
    background: keep(selection.background, model.supportedBackgrounds),
  };
}

export const supportedAspects = (model: Model | null) =>
  ASPECT_OPTIONS.filter((option) => model?.supportedAspectRatios?.includes(option.value));

/**
 * Flyout submenus for the quality / resolution / background levers the model
 * supports. Aspect has its own picker in the dialog, so it is left out here.
 */
export function rendererSubmenus(
  model: Model | null,
  selection: RenderSelection,
  onChange: (selection: RenderSelection) => void,
  icons: { quality: React.ReactNode; resolution: React.ReactNode; background: React.ReactNode },
): SubmenuConfig[] {
  const submenus: SubmenuConfig[] = [];
  const quality = QUALITY_OPTIONS.filter((option) => model?.supportedQualities?.includes(option.value));
  const resolution = RESOLUTION_OPTIONS.filter((option) => model?.supportedResolutions?.includes(option.value));
  const background = BACKGROUND_OPTIONS.filter((option) => model?.supportedBackgrounds?.includes(option.value));
  if (quality.length) {
    submenus.push({
      icon: icons.quality,
      label: "Quality",
      options: quality,
      value: selection.quality,
      onChange: (value) => onChange({ ...selection, quality: value as ImageQuality | null }),
      allowDeselect: true,
      defaultLabel: "Auto",
    });
  }
  if (resolution.length) {
    submenus.push({
      icon: icons.resolution,
      label: "Resolution",
      options: resolution,
      value: selection.resolution,
      onChange: (value) => onChange({ ...selection, resolution: value as ImageResolution | null }),
      allowDeselect: true,
      defaultLabel: "Auto",
    });
  }
  if (background.length) {
    submenus.push({
      icon: icons.background,
      label: "Background",
      options: background,
      value: selection.background,
      onChange: (value) => onChange({ ...selection, background: value as ImageBackground | null }),
      allowDeselect: true,
      defaultLabel: "Auto",
    });
  }
  return submenus;
}
