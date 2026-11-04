import { useState } from "react";
import type { EditorHandle } from "../../hooks/useEditor";
import { type ColorMix, MIXER_BANDS, NEUTRAL_MIX, sliderRange } from "../../lib/recipe";
import { cn } from "@/shared/lib/cn";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { AdjustmentSlider } from "../AdjustmentSlider";
import { PanelSection } from "../Inspector";

const TEMPERATURE_TRACK = "linear-gradient(90deg, #3b82f6, #d4d4d4 50%, #f59e0b)";
const TINT_TRACK = "linear-gradient(90deg, #22c55e, #d4d4d4 50%, #d946ef)";

function hueTrack(center: number) {
  const stops = Array.from({ length: 7 }, (_, index) => `hsl(${center - 45 + index * 15} 80% 55%)`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

const saturationTrack = (swatch: string) => `linear-gradient(90deg, #9ca3af, ${swatch})`;
const luminanceTrack = (swatch: string) => `linear-gradient(90deg, #111827, ${swatch}, #f9fafb)`;

export function ColorPanel({ editor, disabled }: { editor: EditorHandle; disabled?: boolean }) {
  const { recipe } = editor;
  const [band, setBand] = useState(0);
  const range = sliderRange("temperature");
  const mix = recipe.mixer[band] ?? NEUTRAL_MIX;
  const setMix = (patch: Partial<ColorMix>, index = band) =>
    editor.change((current) => ({
      ...current,
      mixer: current.mixer.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));

  return (
    <>
      <PanelSection>
        <SegmentedControl
          value={recipe.grayscale ? "mono" : "color"}
          onChange={(value) => editor.apply({ grayscale: value === "mono" })}
          options={[
            { value: "color", label: "Color" },
            { value: "mono", label: "Black & white" },
          ]}
          disabled={disabled}
        />
      </PanelSection>
      <PanelSection title="White balance">
        <AdjustmentSlider
          label="Temperature"
          value={recipe.temperature}
          {...range}
          track={TEMPERATURE_TRACK}
          disabled={disabled}
          onChange={(value) => editor.change({ temperature: value })}
          onCommit={editor.commit}
        />
        <AdjustmentSlider
          label="Tint"
          value={recipe.tint}
          {...range}
          track={TINT_TRACK}
          disabled={disabled}
          onChange={(value) => editor.change({ tint: value })}
          onCommit={editor.commit}
        />
      </PanelSection>
      {!recipe.grayscale && (
        <PanelSection title="Presence">
          <AdjustmentSlider
            label="Vibrance"
            value={recipe.vibrance}
            {...range}
            disabled={disabled}
            onChange={(value) => editor.change({ vibrance: value })}
            onCommit={editor.commit}
          />
          <AdjustmentSlider
            label="Saturation"
            value={recipe.saturation}
            {...range}
            disabled={disabled}
            onChange={(value) => editor.change({ saturation: value })}
            onCommit={editor.commit}
          />
        </PanelSection>
      )}
      <PanelSection title={recipe.grayscale ? "Black & white mix" : "Color mixer"}>
        {recipe.grayscale ? (
          MIXER_BANDS.map((meta, index) => (
            <AdjustmentSlider
              key={meta.key}
              label={meta.label}
              value={recipe.mixer[index]?.luminance ?? 0}
              {...range}
              track={luminanceTrack(meta.swatch)}
              disabled={disabled}
              onChange={(value) => setMix({ luminance: value }, index)}
              onCommit={editor.commit}
            />
          ))
        ) : (
          <>
            <div role="radiogroup" aria-label="Color band" className="flex items-center justify-between py-1">
              {MIXER_BANDS.map((meta, index) => {
                const edited =
                  recipe.mixer[index] &&
                  (recipe.mixer[index].hue !== 0 ||
                    recipe.mixer[index].saturation !== 0 ||
                    recipe.mixer[index].luminance !== 0);
                return (
                  <button
                    key={meta.key}
                    type="button"
                    role="radio"
                    aria-checked={index === band}
                    aria-label={meta.label}
                    title={meta.label}
                    disabled={disabled}
                    onClick={() => setBand(index)}
                    className={cn(
                      "relative size-6 rounded-full transition-transform hover:scale-110",
                      index === band &&
                        "ring-2 ring-neutral-900 ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-neutral-900",
                    )}
                    style={{ background: meta.swatch }}
                  >
                    {edited && (
                      <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-white ring-1 ring-black/20 dark:bg-neutral-100" />
                    )}
                  </button>
                );
              })}
            </div>
            <AdjustmentSlider
              label="Hue"
              value={mix.hue}
              {...range}
              track={hueTrack(MIXER_BANDS[band].hue)}
              disabled={disabled}
              onChange={(value) => setMix({ hue: value })}
              onCommit={editor.commit}
            />
            <AdjustmentSlider
              label="Saturation"
              value={mix.saturation}
              {...range}
              track={saturationTrack(MIXER_BANDS[band].swatch)}
              disabled={disabled}
              onChange={(value) => setMix({ saturation: value })}
              onCommit={editor.commit}
            />
            <AdjustmentSlider
              label="Luminance"
              value={mix.luminance}
              {...range}
              track={luminanceTrack(MIXER_BANDS[band].swatch)}
              disabled={disabled}
              onChange={(value) => setMix({ luminance: value })}
              onCommit={editor.commit}
            />
          </>
        )}
      </PanelSection>
    </>
  );
}
