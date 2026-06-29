import { useCallback, useEffect, useState } from "react";
import { getConfig } from "@/shared/config";
import { supportedEfforts } from "@/shared/lib/models";
import type { Model } from "@/shared/types/chat";

const STORAGE_KEY = "app_model";

type Effort = NonNullable<Model["effort"]>;
const EFFORTS = new Set<string>(["none", "minimal", "low", "medium", "high", "xhigh"]);

// Fill in heuristic reasoning-effort levels when config didn't specify them.
// An explicit `supportedEfforts` (including `[]` to hide the picker) is kept.
function withEffortFallback(model: Model): Model {
  if (model.supportedEfforts !== undefined) return model;
  const efforts = supportedEfforts(model.id);
  return efforts ? { ...model, supportedEfforts: efforts } : model;
}

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

export function useModels() {
  const config = getConfig();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModelState] = useState<Model | null>(null);

  // Load models from API, filtering config models to only those that exist
  useEffect(() => {
    const loadModels = async () => {
      try {
        const apiModels = await config.client.listModels("completer");
        const apiModelIds = new Set(apiModels.map((m) => m.id));

        let resolvedModels: Model[];

        if (config.models.length > 0) {
          // Configured models drive the visible list; everything else the API
          // exposes is appended as hidden so it can still be reached via the
          // Option-click escape hatch in the model selector.
          const configured = config.models.filter((m) => apiModelIds.has(m.id));
          const configuredIds = new Set(configured.map((m) => m.id));
          const extras = apiModels.filter((m) => !configuredIds.has(m.id)).map((m) => ({ ...m, hidden: true }));
          resolvedModels = [...configured, ...extras].map(withEffortFallback);
        } else {
          resolvedModels = apiModels.map(withEffortFallback);
        }

        setModels(resolvedModels);

        // Restore selected model (and its saved effort) from localStorage, or default to first
        if (resolvedModels.length > 0) {
          let saved: { id: string; effort?: Effort } | null = null;
          try {
            saved = parseSavedModel(localStorage.getItem(STORAGE_KEY));
          } catch {
            // ignore localStorage errors
          }
          const savedModel = saved ? resolvedModels.find((model) => model.id === saved.id) : undefined;
          if (savedModel) {
            setSelectedModelState(saved?.effort ? { ...savedModel, effort: saved.effort } : savedModel);
            return;
          }
          setSelectedModelState(resolvedModels[0]);
        }
      } catch (error) {
        console.error("error loading models", error);
      }
    };

    void loadModels();
  }, [config.client, config.models]);

  // Function to update selected model and save to localStorage
  const setSelectedModel = useCallback((model: Model | null) => {
    setSelectedModelState(model);

    try {
      if (model && model.id !== "realtime") {
        // Persist the effort alongside the id ("id@effort") so a fresh chat after
        // reload defaults to the last chosen effort, not just the last model.
        localStorage.setItem(STORAGE_KEY, model.effort ? `${model.id}@${model.effort}` : model.id);
      } else if (!model) {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Silently handle localStorage errors
    }
  }, []);

  return {
    models,
    selectedModel,
    setSelectedModel,
    getSavedModelId,
  };
}
