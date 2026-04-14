import { useEffect, useState } from "react";
import { getConfig } from "@/shared/config";
import type { Model } from "@/shared/types/chat";

const STORAGE_KEY = "app_model";

// Helper to get saved model from localStorage
function getSavedModelId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
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
          // Filter config models to only those that exist in the API
          resolvedModels = config.models.filter((m) => apiModelIds.has(m.id));
        } else {
          resolvedModels = apiModels;
        }

        setModels(resolvedModels);

        // Restore selected model from localStorage or default to first
        if (resolvedModels.length > 0) {
          const savedModelId = getSavedModelId();
          if (savedModelId) {
            const savedModel = resolvedModels.find((model) => model.id === savedModelId);
            if (savedModel) {
              setSelectedModelState(savedModel);
              return;
            }
          }
          setSelectedModelState(resolvedModels[0]);
        }
      } catch (error) {
        console.error("error loading models", error);
      }
    };

    loadModels();
  }, [config.client, config.models]);

  // Function to update selected model and save to localStorage
  const setSelectedModel = (model: Model | null) => {
    setSelectedModelState(model);

    try {
      if (model) {
        localStorage.setItem(STORAGE_KEY, model.id);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Silently handle localStorage errors
    }
  };

  return {
    models,
    selectedModel,
    setSelectedModel,
  };
}
