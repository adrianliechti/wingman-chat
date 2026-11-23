import type { ModelPresetConfig } from "@/shared/config";
import type { Model, ReasoningEffort } from "@/shared/types/chat";
import { findModel } from "./models";

/** A slider step resolved against the model catalog. */
export interface ModelPreset {
  model: Model;
  /** Effort this step selects; unset when the model offers no effort levels. */
  effort?: ReasoningEffort;
  /** Verbosity this step selects; unset leaves it to the backend. */
  verbosity?: Model["verbosity"];
  label: string;
}

/**
 * Resolves configured presets against the available chat models. Steps whose
 * model is unavailable are dropped, and an effort the model does not support
 * falls back to its default, so a stale config never selects an invalid level.
 */
export function resolveModelPresets(configured: readonly ModelPresetConfig[] | undefined, models: readonly Model[]) {
  if (!configured?.length) return [];
  return configured.flatMap((preset): ModelPreset[] => {
    const model = findModel(models, preset.model);
    if (!model) return [];
    const supported = model.supportedEfforts;
    const effort =
      preset.effort && (!supported || supported.includes(preset.effort))
        ? preset.effort
        : (model.defaultEffort ?? model.effort);
    const verbosity = preset.verbosity ?? model.verbosity;
    return [{ model, effort, verbosity, label: preset.label || model.name || model.id }];
  });
}

/** Index of the preset matching the model, effective effort and verbosity, or -1. */
export function modelPresetIndex(presets: readonly ModelPreset[], model: Model | null | undefined) {
  if (!model) return -1;
  const effort = model.effort ?? model.defaultEffort;
  return presets.findIndex(
    (preset) =>
      preset.model.id === model.id &&
      (preset.effort ?? preset.model.defaultEffort) === effort &&
      preset.verbosity === model.verbosity,
  );
}

const EFFORT_ORDER: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Where a selection that matches no preset still sits on the slider: the step
 * for the same model whose effort is closest, the earlier one on a tie. -1 when
 * the model has no step at all.
 */
export function nearestModelPresetIndex(presets: readonly ModelPreset[], model: Model | null | undefined) {
  if (!model) return -1;
  const rank = (effort: ReasoningEffort | undefined) => (effort ? EFFORT_ORDER.indexOf(effort) : -1);
  const target = rank(model.effort ?? model.defaultEffort);
  let nearest = -1;
  let distance = Infinity;
  presets.forEach((preset, index) => {
    if (preset.model.id !== model.id) return;
    const step = rank(preset.effort ?? preset.model.defaultEffort);
    // Without an effort on either side there is nothing to compare; the first step wins.
    const gap = target < 0 || step < 0 ? 0 : Math.abs(step - target);
    if (gap < distance) {
      nearest = index;
      distance = gap;
    }
  });
  return nearest;
}

/** A backend model with this ID picks the model itself; the slider offers it as its own stop. */
export const AUTO_MODEL_ID = "auto";

export function findAutoModel(models: readonly Model[]) {
  return models.find((model) => model.id === AUTO_MODEL_ID);
}
