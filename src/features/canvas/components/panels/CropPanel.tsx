import { ArrowLeftRight, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from "lucide-react";
import type { EditorHandle } from "../../hooks/useEditor";
import {
  canvasSize,
  cropBounds,
  cropPixelRatio,
  fitAspect,
  flipGeometry,
  GEOMETRY,
  type Geometry,
  isDefaultGeometry,
  largestCrop,
  NO_CROP,
  rotateGeometry,
} from "../../lib/geometry";
import { cn } from "@/shared/lib/cn";
import { AdjustmentSlider } from "../AdjustmentSlider";
import { PanelSection } from "../Inspector";

/** Aspect presets; `value` is width / height in pixels, null keeps the canvas ratio, 0 is free. */
export const ASPECT_PRESETS = [
  { id: "free", label: "Free", value: 0 },
  { id: "original", label: "Original", value: null },
  { id: "1:1", label: "1:1", value: 1 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "3:2", label: "3:2", value: 3 / 2 },
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "4:5", label: "4:5", value: 4 / 5 },
  { id: "9:16", label: "9:16", value: 9 / 16 },
] as const;

export type AspectPreset = (typeof ASPECT_PRESETS)[number]["id"];

/** Locked crop ratio in overlay (UV) units for a preset; 0 when free. */
export function presetRatio(preset: AspectPreset, swapped: boolean, cw: number, ch: number): number {
  const entry = ASPECT_PRESETS.find((item) => item.id === preset);
  if (!entry || entry.value === 0) return 0;
  const pixels = entry.value === null ? cw / ch : entry.value;
  return (swapped ? 1 / pixels : pixels) / (cw / ch);
}

const BUTTON =
  "flex items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-white";

interface CropPanelProps {
  editor: EditorHandle;
  /** Source pixel size (preview resolution is fine; only the ratio matters). */
  source: [number, number];
  preset: AspectPreset;
  swapped: boolean;
  onPreset: (preset: AspectPreset, swapped: boolean) => void;
  onDone: () => void;
  disabled?: boolean;
}

export function CropPanel({ editor, source, preset, swapped, onPreset, onDone, disabled }: CropPanelProps) {
  const geometry = editor.recipe.geometry;
  const [cw, ch] = canvasSize(geometry, source[0], source[1]);
  const setGeometry = (next: Geometry) => editor.apply((recipe) => ({ ...recipe, geometry: next }));

  const choosePreset = (next: AspectPreset, nextSwapped: boolean) => {
    onPreset(next, nextSwapped);
    const ratio = presetRatio(next, nextSwapped, cw, ch);
    if (!ratio) return;
    // Keep the straighten angle's safe area when one is set, else refit the current frame.
    const crop = geometry.angle
      ? largestCrop(geometry.angle, cw, ch, ratio * (cw / ch))
      : fitAspect(cropBounds(geometry.crop), ratio);
    setGeometry({ ...geometry, crop });
  };

  const straighten = (angle: number) => {
    // The frame shrinks to the largest crop of the current ratio that fits
    // inside the turned picture, so no empty corners appear.
    const ratio = angle ? cropPixelRatio(geometry, source[0], source[1]) : 0;
    const crop = angle ? largestCrop(angle, cw, ch, ratio) : geometry.crop;
    editor.change((recipe) => ({ ...recipe, geometry: { ...recipe.geometry, angle, crop } }));
  };

  const canSwap = preset !== "free" && preset !== "1:1";

  return (
    <>
      <PanelSection title="Aspect">
        <div role="radiogroup" aria-label="Crop aspect" className="flex flex-wrap gap-1.5">
          {ASPECT_PRESETS.map((item) => {
            const checked = preset === item.id;
            const label =
              swapped && item.value && item.value !== 1 ? item.label.split(":").reverse().join(":") : item.label;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => choosePreset(item.id, swapped)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  checked
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                    : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-white",
                )}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            title="Swap orientation"
            aria-label="Swap orientation"
            disabled={disabled || !canSwap}
            onClick={() => choosePreset(preset, !swapped)}
            className={cn(BUTTON, "rounded-full px-2 py-1")}
          >
            <ArrowLeftRight size={13} />
          </button>
        </div>
      </PanelSection>
      <PanelSection>
        <AdjustmentSlider
          label="Straighten"
          value={geometry.angle}
          min={-45}
          max={45}
          step={0.1}
          disabled={disabled}
          onChange={straighten}
          onCommit={editor.commit}
        />
      </PanelSection>
      <PanelSection title="Rotate & flip">
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            className={BUTTON}
            title="Rotate left 90°"
            aria-label="Rotate left"
            disabled={disabled}
            onClick={() => setGeometry(rotateGeometry(geometry, -1))}
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            className={BUTTON}
            title="Rotate right 90°"
            aria-label="Rotate right"
            disabled={disabled}
            onClick={() => setGeometry(rotateGeometry(geometry, 1))}
          >
            <RotateCw size={16} />
          </button>
          <button
            type="button"
            className={cn(
              BUTTON,
              geometry.flipH && "border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400",
            )}
            title="Flip horizontal"
            aria-label="Flip horizontal"
            aria-pressed={geometry.flipH}
            disabled={disabled}
            onClick={() => setGeometry(flipGeometry(geometry, "horizontal"))}
          >
            <FlipHorizontal2 size={16} />
          </button>
          <button
            type="button"
            className={cn(
              BUTTON,
              geometry.flipV && "border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400",
            )}
            title="Flip vertical"
            aria-label="Flip vertical"
            aria-pressed={geometry.flipV}
            disabled={disabled}
            onClick={() => setGeometry(flipGeometry(geometry, "vertical"))}
          >
            <FlipVertical2 size={16} />
          </button>
        </div>
      </PanelSection>
      <p className="py-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        Drag the frame's edges to crop and inside it to move. Arrow keys nudge the focused handle.
      </p>
      <div className="flex items-center justify-between gap-2 pt-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={BUTTON}
            disabled={disabled || (!geometry.crop.width && !geometry.crop.height)}
            onClick={() => setGeometry({ ...geometry, crop: NO_CROP })}
          >
            Reset crop
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={disabled || isDefaultGeometry(geometry)}
            onClick={() => {
              onPreset("free", false);
              setGeometry(GEOMETRY);
            }}
          >
            Reset all
          </button>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Done
        </button>
      </div>
    </>
  );
}
