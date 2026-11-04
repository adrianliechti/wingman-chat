import type { EditorHandle } from "../../hooks/useEditor";
import { sliderRange } from "../../lib/recipe";
import { AdjustmentSlider } from "../AdjustmentSlider";
import { PanelSection } from "../Inspector";

const LIGHT = [
  ["exposure", "Exposure"],
  ["contrast", "Contrast"],
  ["highlights", "Highlights"],
  ["shadows", "Shadows"],
  ["whites", "Whites"],
  ["blacks", "Blacks"],
] as const;

export function LightPanel({ editor, disabled }: { editor: EditorHandle; disabled?: boolean }) {
  return (
    <PanelSection>
      {LIGHT.map(([key, label]) => (
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
