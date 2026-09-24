import type { ModelPresetConfig } from "@/shared/config";
import type { Model, ReasoningEffort } from "@/shared/types/chat";

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
  const byId = new Map(models.map((model) => [model.id, model]));
  return configured.flatMap((preset): ModelPreset[] => {
    const model = byId.get(preset.model);
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
