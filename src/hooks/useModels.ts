import { useState, useEffect } from "react";
import type { Model } from "../types/chat";
import { getConfig } from "../config";

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
  const [models, setModels] = useState<Model[]>(() => {
    // Initialize with config models if available
    return config.models.length > 0 ? config.models : [];
  });
  
  // Initialize selected model from localStorage if models are already available
  const [selectedModel, setSelectedModelState] = useState<Model | null>(() => {
    if (config.models.length === 0) return null;
    
    const savedModelId = getSavedModelId();
    if (savedModelId) {
      const savedModel = config.models.find(model => model.id === savedModelId);
      if (savedModel) return savedModel;
    }
    return config.models[0] || null;
  });

  // Load models from API if not in config
  useEffect(() => {
    if (config.models.length > 0) return;

    const loadModels = async () => {
      try {
        const loadedModels = await config.client.listModels("completer");
        setModels(loadedModels);
        
        // Set selected model after loading
        if (loadedModels.length > 0) {
          const savedModelId = getSavedModelId();
          if (savedModelId) {
            const savedModel = loadedModels.find(model => model.id === savedModelId);
            if (savedModel) {
              setSelectedModelState(savedModel);
              return;
            }
          }
          setSelectedModelState(loadedModels[0]);
        }
      } catch (error) {
        console.error("error loading models", error);
      }
    };

    loadModels();
  }, [config.client, config.models.length]);

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
