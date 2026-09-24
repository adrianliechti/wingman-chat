import { useCallback, useEffect, useMemo, useState } from "react";
import { getConfig } from "@/shared/config";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import { defaultModelId } from "@/shared/lib/models";
import type { Model } from "@/shared/types/chat";

const STORAGE_KEY = "app_model";
// Kept apart from STORAGE_KEY so its "id@effort" format stays readable by older builds.
const VERBOSITY_STORAGE_KEY = "app_model_verbosity";
const VERBOSITIES = new Set<string>(["low", "medium", "high"]);

type Effort = NonNullable<Model["effort"]>;
const EFFORTS = new Set<string>(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

// The default model is persisted as "id" or "id@effort". Parse from the right and
// validate the suffix against the known efforts so legacy values (plain id) and
// ids that happen to contain "@" still resolve to the right model id.
function parseSavedModel(raw: string | null): { id: string; effort?: Effort } | null {
  if (!raw) return null;
  const at = raw.lastIndexOf("@");
  const suffix = at > 0 ? raw.slice(at + 1) : "";
  return EFFORTS.has(suffix) ? { id: raw.slice(0, at), effort: suffix as Effort } : { id: raw };
}

// Helper to get the saved default model id from localStorage (without the effort suffix).
export function getSavedModelId(): string | null {
  try {
    return parseSavedModel(localStorage.getItem(STORAGE_KEY))?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The saved default model with its saved effort and verbosity, or null when it's
 * no longer available. Used to leave voice mode without losing those settings.
 */
export function getSavedModel(models: readonly Model[]): Model | null {
  let saved: { id: string; effort?: Effort } | null = null;
  let verbosity: string | null = null;
  try {
    saved = parseSavedModel(localStorage.getItem(STORAGE_KEY));
    verbosity = localStorage.getItem(VERBOSITY_STORAGE_KEY);
  } catch {
    // Ignore localStorage errors.
  }
  const model = models.find((model) => model.id === saved?.id);
  if (!model) return null;
  const effort = saved?.effort;
  return {
    ...model,
    ...(effort && (!model.supportedEfforts || model.supportedEfforts.includes(effort)) ? { effort } : {}),
    ...(verbosity && VERBOSITIES.has(verbosity) ? { verbosity: verbosity as Model["verbosity"] } : {}),
  };
}

export function useModels() {
  const config = getConfig();
  const available = useModelCatalog("completer");
  // undefined means no choice has been made yet; an explicit null is a choice too.
  const [selectedModel, setSelectedModelState] = useState<Model | null | undefined>(undefined);
  const models = useMemo(() => {
    const byId = new Map(available.map((model) => [model.id, model]));
    const configured = config.models.flatMap((model) => {
      const resolved = byId.get(model.id);
      byId.delete(model.id);
      return resolved ? [resolved] : [];
    });
    // Only configured chat models curate the chat picker. A renderer-only config
    // must not hide every chat model. Unconfigured chat models stay reachable via
    // Option-click when there is a curated list.
    return configured.length
      ? [...configured, ...Array.from(byId.values(), (model) => ({ ...model, hidden: true }))]
      : available;
  }, [available, config.models]);

  // Restore once, without overwriting a choice made while loading (including
  // realtime), or changing an active chat's model/effort on background refresh.
  useEffect(() => {
    if (!models.length) return;
    setSelectedModelState((current) => {
      if (current !== undefined) return current;
      return getSavedModel(models) ?? models.find((model) => model.id === defaultModelId(models)) ?? models[0];
    });
  }, [models]);

  // Function to update selected model and save to localStorage
  const setSelectedModel = useCallback((model: Model | null) => {
    setSelectedModelState(model);

    try {
      if (model && model.id !== "realtime") {
        // Persist the effort alongside the id ("id@effort") so a fresh chat after
        // reload defaults to the last chosen effort, not just the last model.
        localStorage.setItem(STORAGE_KEY, model.effort ? `${model.id}@${model.effort}` : model.id);
        // Verbosity a slider preset chose; unset leaves the model's own default.
        if (model.verbosity) localStorage.setItem(VERBOSITY_STORAGE_KEY, model.verbosity);
        else localStorage.removeItem(VERBOSITY_STORAGE_KEY);
      } else if (!model) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(VERBOSITY_STORAGE_KEY);
      }
    } catch {
      // Silently handle localStorage errors
    }
  }, []);

  return {
    models,
    selectedModel: selectedModel ?? null,
    setSelectedModel,
    getSavedModelId,
  };
}
