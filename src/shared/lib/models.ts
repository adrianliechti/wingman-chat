import type {
  ImageBackground,
  ImageQuality,
  ImageResolution,
  Model,
  ModelType,
  ReasoningEffort,
} from "@/shared/types/chat";

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
 * `supportedEfforts: []` still hides the picker.
 */
export function supportedEfforts(id: string): ReasoningEffort[] | undefined {
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
  // Effort exists from Opus 4.5 on. `max` arrived with the 4.6 generation, but
  // `xhigh` only with Opus 4.7 / Sonnet 5 — Opus 4.6 and Sonnet 4.6 have max
  // without xhigh. Opus 4.5 and older Claude stop at high.
  if (
    /opus-?4[.-][7-9]\b/.test(lowerId) ||
    /(opus|sonnet)-?[5-9]\b/.test(lowerId) ||
    lowerId.includes("fable") ||
    lowerId.includes("mythos")
  ) {
    return ["low", "medium", "high", "xhigh", "max"];
  }
  if (/(opus|sonnet)-?4[.-]6\b/.test(lowerId)) return ["low", "medium", "high", "max"];
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
  if (/glm-?5[.-][2-9]/.test(lowerId) || /glm-?[6-9]/.test(lowerId))
    return ["low", "medium", "high", "xhigh"];
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

/**
 * The level a model reasons at when no effort is sent, so the picker can badge
 * it "Default" the way the provider consoles do. Only claimed where the vendor
 * documents it — a wrong badge is worse than none, and config's `effort` covers
 * everything else (including aliased ids this can't read):
 *
 * - Anthropic documents `high` for every effort-capable Claude model, and that
 *   passing `high` is identical to omitting the parameter.
 * - OpenAI documents defaults as model-dependent, and names `medium` for both
 *   gpt-5.5 and gpt-5.6 (the latter in the reasoning-mode section: omitting
 *   `reasoning.effort` is `medium` in standard and pro alike). Earlier GPT-5
 *   point releases and the o-series have no stated default, so they stay unset.
 */
export function defaultEffort(id: string): ReasoningEffort | undefined {
  const lowerId = id.toLowerCase();

  if (lowerId.includes("claude") || lowerId.includes("fable") || lowerId.includes("mythos")) {
    return supportedEfforts(id)?.includes("high") ? "high" : undefined;
  }

  // The mini/nano/chat variants are separate models with no stated default.
  if (/gpt-?5[.-][56]\b/.test(lowerId) && !/mini|nano|chat/.test(lowerId)) {
    return "medium";
  }

  return undefined;
}

/** Lowest-cost reasoning effort known to be supported by a model. */
export function minimalEffort(id: string): ReasoningEffort | undefined {
  const supported = supportedEfforts(id);
  if (!supported) return undefined;

  const ordered: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  return ordered.find((effort) => supported.includes(effort));
}

/**
 * Best-guess token budget for the active chat window before proactive
 * compaction kicks in, the fallback when a model's config omits
 * `compactThreshold` (an explicit config value — including 0 to disable —
 * always wins). 272k mirrors the GPT-5 input cap (400k window minus 128k
 * reserved for output); past ~200–272k input every hosted family is into its
 * premium or failure territory, so unknown ids default there too. Models with
 * small windows (local llama etc.) should set an explicit value in config —
 * the heuristic only knows the major hosted families.
 */
export function compactThreshold(id: string): number {
  const lowerId = id.toLowerCase();

  // 128k-window OpenAI models: gpt-4o / gpt-4-turbo / o1.
  if (/gpt-?4o|gpt-?4-turbo|\bo1\b/.test(lowerId)) return 100_000;
  // o3 / o4: 200k window shared with the reply — leave room to answer.
  if (/\bo[34]\b/.test(lowerId)) return 176_000;
  // Anthropic: Haiku and pre-4.6 Claude keep a 200k window shared with the
  // reply. Current models (Opus/Sonnet 4.6+, Fable 5, Sonnet 5) have a 1M
  // window at standard pricing — the former >200k long-context premium is
  // gone — so they take the generic default below.
  if (/haiku|claude-?[123]\b|claude-?3[.-]/.test(lowerId)) return 176_000;
  if (/(opus|sonnet)-?4[.-][0-5]\b/.test(lowerId)) return 176_000;
  // Google: Gemini long-context pricing doubles above 200k prompt tokens.
  if (lowerId.includes("gemini")) return 200_000;

  // GPT-5 family (272k input cap) and unknown ids.
  return 272_000;
}

export interface RendererCapabilities {
  qualities?: ImageQuality[];
  aspectRatios?: string[];
  resolutions?: ImageResolution[];
  backgrounds?: ImageBackground[];
}

// A broad set of aspect ratios most image models can approximate; the backend
// snaps each request to the nearest the target model actually supports.
const GENERIC_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

/**
 * Best-guess image-generation capabilities for a renderer model id, the fallback
 * when config omits them (the renderer analogue of {@link supportedEfforts}).
 * Config always wins; an unknown id falls back to a permissive generic profile so
 * the Canvas pickers still work — the backend silently drops anything the target
 * model can't honor.
 */
export function rendererCapabilities(id: string): RendererCapabilities {
  const lowerId = id.toLowerCase();

  // ── OpenAI gpt-image ──
  // gpt-image-1 / 1.5 expose low/medium/high quality plus an opaque/transparent
  // background control; gpt-image-2 keeps the quality tiers but drops background.
  if (/gpt-?image-?2/.test(lowerId)) {
    return { qualities: ["low", "medium", "high"], aspectRatios: ["1:1", "3:2", "2:3"] };
  }
  if (lowerId.includes("gpt-image") || lowerId.includes("gptimage")) {
    return {
      qualities: ["low", "medium", "high"],
      aspectRatios: ["1:1", "3:2", "2:3"],
      backgrounds: ["opaque", "transparent"],
    };
  }

  // ── OpenAI DALL·E 3 ── standard/hd quality, three fixed sizes, no transparency.
  if (/dall-?e-?3/.test(lowerId)) {
    return { qualities: ["medium", "high"], aspectRatios: ["1:1", "16:9", "9:16"] };
  }

  // ── Google Gemini image ("nano-banana") ── no quality tiers; the size lever is
  // a 1K/2K/4K output resolution instead.
  if (/gemini.*image|nano-?banana/.test(lowerId)) {
    return {
      aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
      resolutions: ["1K", "2K", "4K"],
    };
  }

  // ── Google Imagen ── aspect only.
  if (lowerId.includes("imagen")) {
    return { aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"] };
  }

  // ── Black Forest Labs FLUX ── aspect only, no quality tiers or transparency.
  if (lowerId.includes("flux")) {
    return { aspectRatios: GENERIC_ASPECTS };
  }

  // Unknown renderer: permissive generic profile (quality + common aspects, no
  // background) so the pickers stay useful.
  return { qualities: ["low", "medium", "high"], aspectRatios: GENERIC_ASPECTS };
}

/**
 * Fill in heuristic renderer capabilities a model's config didn't specify. An
 * explicit config value (including `[]` to hide a picker) is kept, exactly like
 * `withEffortFallback` does for chat reasoning efforts.
 */
export function withRendererFallback(model: Model): Model {
  const caps = rendererCapabilities(model.id);
  return {
    ...model,
    supportedQualities: model.supportedQualities ?? caps.qualities,
    supportedAspectRatios: model.supportedAspectRatios ?? caps.aspectRatios,
    supportedResolutions: model.supportedResolutions ?? caps.resolutions,
    supportedBackgrounds: model.supportedBackgrounds ?? caps.backgrounds,
  };
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

  // Check for transcription models first — these speech-to-text ids ("…-stt",
  // whisper, gpt-4o-transcribe) often also contain "voice"/"audio", so match the
  // more specific transcriber cue before the text-to-speech catch-all below.
  if (lowerId.includes("stt") || lowerId.includes("transcribe") || lowerId.includes("whisper")) {
    return "transcriber";
  }

  // Check for text-to-speech / voice models
  if (
    lowerId.includes("tts") ||
    lowerId.includes("voice") ||
    lowerId.includes("speech") ||
    lowerId.includes("audio") ||
    lowerId.includes("eleven")
  ) {
    return "synthesizer";
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
  const normalizedId = id
    // Provider-qualified ids use dots as namespace separators (for example,
    // `anthropic.claude-…`). Keep decimal version dots such as `4.6` intact.
    .replace(/([a-z])\.([a-z])/gi, "$1-$2")
    .replace(/-(\d+)-(\d+)(?=(?:-|$))/g, "-$1.$2");

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

      if (lowerWord === "mai") {
        return "MAI";
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

const REGION_QUALIFIED_MODEL_ID =
  /^(?:[a-z]{2}|global)\.(?=(?:[a-z0-9-]+\.)?(?:claude|gpt|o[134]|gemini|imagen|dall-e|flux|llama|mistral|magistral|deepseek|glm|kimi|qwen|nemotron|nova|command|jamba|grok|phi|mai|fable)(?:[.-]|$))/i;
const CHAT_MODEL_VENDOR_PREFIX = /^(?:anthropic|openai)[./:-]+/i;

export function shortModelName(id: string): string {
  const unqualifiedId = id
    // Cross-region inference profiles prefix the real model id with a country
    // code (for example `eu.` or `ch.`) or `global.`. Only strip it when the
    // remainder starts with a known model family, avoiding clashes with real
    // two-letter namespaces.
    .replace(REGION_QUALIFIED_MODEL_ID, "")
    // The chat footer already has limited space and the family identifies these
    // models clearly enough. Keep full vendor names elsewhere, such as pickers.
    .replace(CHAT_MODEL_VENDOR_PREFIX, "")
    .replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, "");

  return modelName(unqualifiedId);
}
