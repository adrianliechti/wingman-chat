import type { ModelType } from "@/shared/types/chat";

export function modelType(id: string): ModelType | undefined {
  const lowerId = id.toLowerCase();
  
  // Check for embedding models
  if (
    lowerId.includes("embedding") || 
    lowerId.includes("embed") ||
    lowerId.includes("bge") ||
    lowerId.includes("clip") ||
    lowerId.includes("gte") ||
    lowerId.includes("minilm")
  ) {
    return "embedder";
  }
  
  // Check for text-to-speech models
  if (
    lowerId.includes("tts") ||
    lowerId.includes("audio") ||
    lowerId.includes("eleven")
  ) {
    return "synthesizer";
  }
  
  // Check for transcription models
  if (
    lowerId.includes("transcribe") ||
    lowerId.includes("whisper")
  ) {
    return "transcriber";
  }
  
  // Check for reranker models
  if (lowerId.includes("reranker")) {
    return "reranker";
  }
  
  // Check for image generation models (renderer)
  if (
    lowerId.includes("image") ||
    lowerId.includes("flux") ||
    lowerId.includes("dall-e") ||
    lowerId.includes("stable-diffusion") ||
    lowerId.includes("midjourney")
  ) {
    return "renderer";
  }
  
  // Default to completer
  return "completer";
}

export function modelName(id: string): string {
  const normalizedId = id.replace(/-(\d+)-(\d+)(?=(?:-|$))/g, '-$1.$2');

  return normalizedId
    .split("-")
    .map(word => {
      const lowerWord = word.toLowerCase();
      
      if (lowerWord === "o1" || lowerWord === "o3" || lowerWord === "o4") {
        return lowerWord;
      }
      
      if (lowerWord === "gpt") {
        return "GPT";
      }

        if (lowerWord === "glm") {
        return "GLM";
      }
      
      if (lowerWord === "aws") {
        return "AWS";
      }

      if (lowerWord === "github") {
        return "GitHub";
      }

      if (lowerWord === "openai") {
        return "OpenAI";
      }

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
