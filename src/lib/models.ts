import type { Model } from "../types/chat";

export type ModelType = "completion";

export function completionModels(models: Model[]): Model[] {
  return models.filter((model) => {
    const id = model.id.toLowerCase();
    
    // Exclude embedding models
    if (
      id.includes("embedding") || 
      id.includes("embed") ||
      id.includes("bge") ||
      id.includes("clip") ||
      id.includes("gte") ||
      id.includes("minilm")
    ) {
      return false;
    }
    
    // Exclude text-to-speech models
    if (
      id.includes("tts") ||
      id.includes("audio") ||
      id.includes("eleven")
    ) {
      return false;
    }
    
    // Exclude image generation models
    if (
      id.includes("image") ||
      id.includes("flux") ||
      id.includes("dall-e")
    ) {
      return false;
    }
    
    // Exclude transcription models
    if (
      id.includes("transcribe") ||
      id.includes("whisper")
    ) {
      return false;
    }
    
    // Exclude reranker models
    if (
      id.includes("reranker")
    ) {
      return false;
    }
    
    return true;
  });
}
