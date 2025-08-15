import { useState, useEffect } from "react";
import type { Model } from "../types/chat";
import { getConfig } from "../config";

const STORAGE_KEY = "app_model";

export function useModels() {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModelState] = useState<Model | null>(null);

  useEffect(() => {
    const config = getConfig();
    const client = config.client;

    if (config?.models?.length > 0) {
      setModels(config.models);
      return;
    }

    const loadModels = async () => {
      try {
        const models = await client.listModels();
        setModels(models);
      } catch (error) {
        console.error("error loading models", error);
      }
    };

    loadModels();
  }, []);

  // Load selected model from localStorage when models change
  useEffect(() => {
    if (models.length === 0) return;

    try {
      const savedModelId = localStorage.getItem(STORAGE_KEY);
      if (savedModelId) {
        // Find the saved model in the current models list
        const savedModel = models.find(model => model.id === savedModelId);
        if (savedModel) {
          setSelectedModelState(savedModel);
          return;
        }
      }
    } catch {
      // Silently handle localStorage errors
    }

    // If no saved model or saved model not found, use the first available model
    if (models[0]) {
      setSelectedModelState(models[0]);
    }
  }, [models]);

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
