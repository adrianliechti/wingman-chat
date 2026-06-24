import type { Model, ModelType } from "@/shared/types/chat";

type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Model id a fresh selection should default to: the saved app default when it's
 * still in the list, otherwise the first visible model. Used by new agents and
 * other "no model chosen yet" spots so they inherit the user's chosen default.
 */
export function defaultModelId(models: Model[], savedId?: string | null): string {
  if (savedId && models.some((m) => m.id === savedId)) return savedId;
  return models.find((m) => !m.hidden)?.id ?? models[0]?.id ?? "";
}

/**
 * Best-guess reasoning-effort levels for a model id, used as a fallback when a
 * model's config omits `supportedEfforts`. Levels are derived from the models.dev
 * catalog (https://models.dev) and kept forgiving: `undefined` (no picker) is the
 * safe default for unknown ids, and config always wins, so an explicit
 * `supportedEfforts: []` still hides the picker. The catalog's separate "max" tier
 * is folded into our top `xhigh` (which the picker labels "Max").
 */
export function supportedEfforts(id: string): Effort[] | undefined {
  const lowerId = id.toLowerCase();

  // ── OpenAI ──
  // GPT-5.x widened its effort set across point releases. Parse the minor version
  // (accepting "." or "-", e.g. gpt-5.1 / gpt-5-1) and bucket accordingly.
  const gpt5 = lowerId.match(/gpt-?5(?:[.-](\d+))?/);
  if (gpt5) {
    if (lowerId.includes("chat")) return undefined; // chat-latest aliases expose no effort picker
    if (lowerId.includes("codex-max")) return ["low", "medium", "high", "xhigh"]; // codex-max tops out at xhigh
    const minor = gpt5[1] ? Number(gpt5[1]) : 0;
    if (minor >= 2) return ["none", "low", "medium", "high", "xhigh"]; // 5.2+
    if (minor === 1) return ["none", "low", "medium", "high"]; // 5.1
    return ["minimal", "low", "medium", "high"]; // 5 (base / mini / nano / codex)
  }
  if (lowerId.includes("gpt-oss")) return ["low", "medium", "high"];
  if (/\bo[134]\b/.test(lowerId)) return ["low", "medium", "high"]; // o1 / o3 / o4 series
  if (/gpt-?[6-9]/.test(lowerId)) return ["none", "low", "medium", "high", "xhigh"]; // GPT-6+ (guess)

  // ── Anthropic ──
  // Opus 4.6+, Sonnet 4.6+ and Fable add a top "Max" tier (folded into xhigh);
  // Opus 4.5 and older Claude stop at high.
  if (
    /opus-?4[.-][6-9]\b/.test(lowerId) ||
    /sonnet-?4[.-][6-9]\b/.test(lowerId) ||
    /(opus|sonnet)-?[5-9]\b/.test(lowerId) ||
    lowerId.includes("fable")
  ) {
    return ["low", "medium", "high", "xhigh"];
  }
  if (lowerId.includes("claude")) return ["low", "medium", "high"];

  // ── Google ──
  // Gemini 3+ Flash adds a "minimal" tier; other Gemini use low/medium/high.
  if (/gemini-?[3-9].*flash/.test(lowerId)) return ["minimal", "low", "medium", "high"];
  if (lowerId.includes("gemini")) return ["low", "medium", "high"];

  // ── Mistral ──
  // mistral-small / mistral-medium expose a none/high toggle (magistral has none).
  if (/mistral-(small|medium)/.test(lowerId)) return ["none", "high"];

  // ── DeepSeek (e.g. hosted on nvidia) ──
  if (/deepseek-?v[4-9]/.test(lowerId)) return ["none", "high", "xhigh"];

  // ── Z.ai GLM ──
  // GLM 5.2+ adds a top "Max" tier (folded into xhigh); earlier GLM stop at high.
  // Levels are host-dependent (many expose none, official z.ai only high/max); we
  // pick the common low/medium/high baseline.
  if (/glm-?5[.-][2-9]/.test(lowerId) || /glm-?[6-9]/.test(lowerId)) return ["low", "medium", "high", "xhigh"];
  if (lowerId.includes("glm")) return ["low", "medium", "high"];

  // ── Moonshot Kimi ──
  // Effort exposure is host-dependent; low/medium/high is the portable baseline.
  if (lowerId.includes("kimi")) return ["low", "medium", "high"];

  // ── NVIDIA Nemotron ──
  // Effort exposure is host-dependent; low/medium/high is the portable baseline.
  if (lowerId.includes("nemotron")) return ["low", "medium", "high"];

  // ── Alibaba Qwen ──
  // Effort exposure is host-dependent; low/medium/high is the portable baseline.
  if (lowerId.includes("qwen")) return ["low", "medium", "high"];

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
