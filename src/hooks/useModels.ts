import { useState, useEffect } from "react";
import type { Model } from "../types/chat";
import { getConfig } from "../config";

const STORAGE_KEY = "app_model";

export function useModels() {
  const config = getConfig();
  const [models, setModels] = useState<Model[]>(() => {
    // Initialize with config models if available
    return config.models.length > 0 ? config.models : [];
  });
  const [selectedModel, setSelectedModelState] = useState<Model | null>(null);

  // Load models from API if not in config
  useEffect(() => {
    if (config.models.length > 0) return;

    const loadModels = async () => {
      try {
        const models = await config.client.listModels("completion");
        setModels(models);
      } catch (error) {
        console.error("error loading models", error);
      }
    };

    loadModels();
  }, [config.client, config.models.length]);

  // Set selected model when models are loaded
  useEffect(() => {
    if (models.length === 0 || selectedModel) return;

    const loadSelectedModel = () => {
      try {
        const savedModelId = localStorage.getItem(STORAGE_KEY);
        if (savedModelId) {
          const savedModel = models.find(model => model.id === savedModelId);
          if (savedModel) {
            setSelectedModelState(savedModel);
            return;
          }
        }
      } catch {
        // Silently handle localStorage errors
      }

      // Use first model as fallback
      setSelectedModelState(models[0] || null);
    };

    loadSelectedModel();
  }, [models, selectedModel]);

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
    setSelectedModel 
  };
}
