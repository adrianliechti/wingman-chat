import type { ModelType } from "@/shared/types/chat";

type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Best-guess reasoning-effort levels for a model id, used as a fallback when a
 * model's config omits `supportedEfforts`. Mirrors the substring heuristics in
 * {@link modelType}: forgiving, with `undefined` (no picker) as the safe default.
 * Config always wins, so an explicit `supportedEfforts: []` still hides the picker.
 */
export function supportedEfforts(id: string): Effort[] | undefined {
  const lowerId = id.toLowerCase();

  // OpenAI GPT-5.x — the supported effort set changed across point releases, so
  // match specific versions before the generic GPT-5+ fallback. Accept "." or
  // "-" as the minor-version separator (e.g. gpt-5.1 / gpt-5-1).
  if (/gpt-?5[.-](4|5)\b/.test(lowerId)) {
    return ["none", "low", "medium", "high", "xhigh"]; // 5.4, 5.5
  }
  if (/gpt-?5[.-]1\b/.test(lowerId)) {
    return ["none", "low", "medium", "high"]; // 5.1
  }
  if (/gpt-?5\b/.test(lowerId)) {
    return ["minimal", "low", "medium", "high"]; // 5 (base)
  }

  // Other OpenAI reasoning families: GPT-6+ and the o1/o3/o4 series.
  if (/\bo[134]\b/.test(lowerId) || /gpt-?[6-9]/.test(lowerId)) {
    return ["none", "low", "medium", "high", "xhigh"];
  }

  // Anthropic Claude and Google Gemini expose a low/medium/high thinking budget.
  if (lowerId.includes("claude") || lowerId.includes("gemini")) {
    return ["low", "medium", "high"];
  }

  return undefined;
}

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
  if (lowerId.includes("tts") || lowerId.includes("audio") || lowerId.includes("eleven")) {
    return "synthesizer";
  }

  // Check for transcription models
  if (lowerId.includes("stt") || lowerId.includes("transcribe") || lowerId.includes("whisper")) {
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
  const normalizedId = id.replace(/-(\d+)-(\d+)(?=(?:-|$))/g, "-$1.$2");

  return normalizedId
    .split("-")
    .map((word) => {
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
