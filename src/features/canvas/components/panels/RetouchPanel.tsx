import { Brush, Eraser, Layers2, Loader2, Square, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { SelectionMode, SelectionTool } from "../../lib/mask";
import { needsPrompt, needsSelection, type RetouchKind, type RetouchRequest } from "../../lib/retouch";
import { cn } from "@/shared/lib/cn";
import { AdjustmentSlider } from "../AdjustmentSlider";
import { PanelSection } from "../Inspector";

export interface SelectionSettings {
  tool: SelectionTool;
  mode: SelectionMode;
  /** Brush diameter in screen pixels. */
  size: number;
  /** 0..100 */
  feather: number;
}

export const DEFAULT_SELECTION_SETTINGS: SelectionSettings = { tool: "brush", mode: "add", size: 48, feather: 25 };

interface RetouchPanelProps {
  settings: SelectionSettings;
  onSettings: (settings: SelectionSettings) => void;
  hasSelection: boolean;
  onInvert: () => void;
  onClear: () => void;
  /** The retouch currently running, if any. */
  running: RetouchKind | null;
  modelName?: string;
  /** The model can return transparent pixels, so "remove background" cuts out the subject. */
  transparent: boolean;
  onRun: (request: RetouchRequest) => void;
  onFlatten: () => void;
  flattenDisabled?: boolean;
  disabled?: boolean;
}

const TOGGLE = "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition-colors";
const ACTION =
  "flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500 dark:hover:text-white";
const PRIMARY =
  "flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:pointer-events-none disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200";

function Toggle<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon: ReactNode }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-0.5 rounded-xl bg-neutral-100/80 p-1 dark:bg-neutral-800/70"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            TOGGLE,
            value === option.value
              ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50"
              : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function RetouchPanel({
  settings,
  onSettings,
  hasSelection,
  onInvert,
  onClear,
  running,
  modelName,
  transparent,
  onRun,
  onFlatten,
  flattenDisabled,
  disabled,
}: RetouchPanelProps) {
  const [prompt, setPrompt] = useState("");
  const text = prompt.trim();
  const busy = running !== null;
  const locked = disabled || busy;
  const canRun = (kind: RetouchKind) =>
    !locked && (!needsSelection(kind) || hasSelection) && (!needsPrompt(kind) || text.length > 0);
  const action = (kind: RetouchKind, label: string, icon: ReactNode, primary = false) => (
    <button
      type="button"
      className={primary ? PRIMARY : ACTION}
      disabled={!canRun(kind)}
      onClick={() => onRun({ kind, prompt: text })}
    >
      {running === kind ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  );

  return (
    <>
      <PanelSection title="Selection">
        <Toggle
          label="Selection tool"
          value={settings.tool}
          onChange={(tool) => onSettings({ ...settings, tool })}
          disabled={locked}
          options={[
            { value: "brush", label: "Brush", icon: <Brush size={13} /> },
            { value: "rect", label: "Rectangle", icon: <Square size={13} /> },
          ]}
        />
        <Toggle
          label="Selection mode"
          value={settings.mode}
          onChange={(mode) => onSettings({ ...settings, mode })}
          disabled={locked}
          options={[
            { value: "add", label: "Add", icon: <Brush size={13} /> },
            { value: "erase", label: "Erase", icon: <Eraser size={13} /> },
          ]}
        />
        {settings.tool === "brush" && (
          <>
            <AdjustmentSlider
              label="Size"
              value={settings.size}
              min={4}
              max={300}
              step={1}
              reset={48}
              disabled={locked}
              onChange={(size) => onSettings({ ...settings, size })}
            />
            <AdjustmentSlider
              label="Feather"
              value={settings.feather}
              min={0}
              max={100}
              step={1}
              reset={25}
              disabled={locked}
              onChange={(feather) => onSettings({ ...settings, feather })}
            />
          </>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={ACTION} disabled={locked} onClick={onInvert}>
            Invert
          </button>
          <button type="button" className={ACTION} disabled={locked || !hasSelection} onClick={onClear}>
            Clear
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          Paint over what should change. Press R to leave retouching.
        </p>
      </PanelSection>

      <PanelSection title="AI retouch">
        <textarea
          aria-label="Retouch instructions"
          rows={3}
          value={prompt}
          disabled={locked}
          placeholder="Describe the change, e.g. a red bicycle leaning on the wall"
          onChange={(event) => setPrompt(event.target.value)}
          className="block w-full resize-none rounded-lg border border-neutral-200 bg-white/70 px-3 py-2 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-500"
        />
        <div className="space-y-1.5">
          {action("remove", "Remove selection", <Eraser size={14} />, hasSelection && !text)}
          {action("replace", "Replace selection", <Wand2 size={14} />, hasSelection && text.length > 0)}
          {action("edit", "Edit whole image", <Wand2 size={14} />, !hasSelection && text.length > 0)}
        </div>
      </PanelSection>

      <PanelSection title="Background">
        <div className="space-y-1.5">
          {action("removeBackground", transparent ? "Remove background" : "Plain background", <Layers2 size={14} />)}
          {action("replaceBackground", "Replace background", <Layers2 size={14} />)}
        </div>
        <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          {hasSelection
            ? "With a selection, only the area around it is replaced."
            : "Describe the new background above, or select the subject first to protect it."}
        </p>
      </PanelSection>

      <PanelSection title="Pixels">
        <button type="button" className={ACTION} disabled={locked || flattenDisabled} onClick={onFlatten}>
          Flatten adjustments into the image
        </button>
        <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          AI edits see the stored pixels, not your sliders. Flatten first if the look should carry over.
          {modelName ? ` Using ${modelName}.` : ""}
        </p>
      </PanelSection>
    </>
  );
}
