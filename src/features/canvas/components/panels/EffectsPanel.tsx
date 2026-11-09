import type { EditorHandle } from "../../hooks/useEditor";
import { sliderRange } from "../../lib/recipe";
import { AdjustmentSlider } from "../AdjustmentSlider";
import { PanelSection } from "../Inspector";

const EFFECTS = [
  ["clarity", "Clarity"],
  ["dehaze", "Dehaze"],
  ["vignette", "Vignette"],
] as const;

export function EffectsPanel({ editor, disabled }: { editor: EditorHandle; disabled?: boolean }) {
  return (
    <PanelSection>
      {EFFECTS.map(([key, label]) => (
        <AdjustmentSlider
          key={key}
          label={label}
          value={editor.recipe[key]}
          {...sliderRange(key)}
          disabled={disabled}
          onChange={(value) => editor.change({ [key]: value })}
          onCommit={editor.commit}
        />
      ))}
    </PanelSection>
  );
}
