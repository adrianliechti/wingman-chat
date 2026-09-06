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

// Ordered profiles for known models, not predictions about future versions.
// Sources and gateway limitations are recorded in docs/model-catalog.md.
// Config can replace these levels, including [] to hide the effort picker.
type ReasoningProfile = [pattern: RegExp, efforts: ReasoningEffort[], defaultEffort?: ReasoningEffort];
const REASONING_PROFILES: ReasoningProfile[] = [
  [/\bgpt-?6-astra\b/, ["low", "medium", "high", "xhigh", "max"]],
  [/\bgpt-?5\.6(?:-(?:sol|terra|luna))?(?=$|[/:]|-\d{4})/, ["none", "low", "medium", "high", "xhigh", "max"], "medium"],
  [/\bgpt-?5\.4-pro\b/, ["medium", "high", "xhigh"], "medium"],
  [/\bgpt-?5\.5(?=$|[/:]|-\d{4})/, ["none", "low", "medium", "high", "xhigh"], "medium"],
  [/\bgpt-?5\.1-codex-max\b/, ["low", "medium", "high", "xhigh"]],
  [/\bgpt-?5\.[23]-codex\b/, ["low", "medium", "high", "xhigh"]],
  [/\bgpt-?5(?:\.1)?-codex\b/, ["low", "medium", "high"]],
  [/\bgpt-?5\.[234](?:-(?:mini|nano))?(?=$|[/:]|-\d{4})/, ["none", "low", "medium", "high", "xhigh"]],
  [/\bgpt-?5\.1(?=$|[/:]|-\d{4})/, ["none", "low", "medium", "high"]],
  [/\bgpt-?5(?:-(?:mini|nano))?(?=$|[/:]|-\d{4})/, ["minimal", "low", "medium", "high"]],
  [/\bgpt-oss\b|\bo[13](?:-mini)?(?=$|[/:]|-\d{4})|\bo4-mini\b/, ["low", "medium", "high"]],

  [/\b(?:fable|mythos)-5(?:\.1)?(?=$|[-/:])/, ["low", "medium", "high", "xhigh", "max"], "high"],
  [/\b(?:opus-4\.[78]|(?:opus|sonnet)-5)(?=$|[-/:])/, ["low", "medium", "high", "xhigh", "max"], "high"],
  [/\b(?:(?:opus|sonnet)-4\.6|mythos-preview)(?=$|[-/:])/, ["low", "medium", "high", "max"], "high"],
  [/\bopus-4\.5(?=$|[-/:])/, ["low", "medium", "high"], "high"],

  [/\bgemini-?3\.[78]-flash\b/, ["low", "medium", "high"], "medium"],
  [/\bgemini-?3\.1-pro\b/, ["low", "medium", "high"], "high"],
  [/\bgemini-?3-pro\b/, ["low", "high"], "high"],
  [/\bgemini-?3(?:\.[156])?-flash\b/, ["minimal", "low", "medium", "high"]],
  [/\bgemini-?2\.5-(?:pro|flash)\b/, ["low", "medium", "high"]],

  [/\bqwen-?3\.8(?:-|$)/, ["none", "low", "medium", "xhigh"], "xhigh"],
  [/\bdeepseek-?v4-(?:flash|pro)\b/, ["none", "low", "high", "max"], "high"],
];

function normalizedModelId(id: string): string {
  return id
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/-(\d+)-(\d{1,2})(?=-|$|:)/g, "-$1.$2");
}

function reasoningProfile(id: string): ReasoningProfile | undefined {
  if (modelType(id) !== "completer") return undefined;
  const normalized = normalizedModelId(id);
  return REASONING_PROFILES.find(([pattern]) => pattern.test(normalized));
}

/** Supported effort choices where known; unknown models use the backend default. */
export function supportedEfforts(id: string): ReasoningEffort[] | undefined {
  return reasoningProfile(id)?.[1].slice();
}

/** Documented baseline, independent of a per-chat effort override. */
export function defaultEffort(id: string): ReasoningEffort | undefined {
  return reasoningProfile(id)?.[2];
}

/** Resolve chat capabilities once, after applying deployment overrides. */
function withEffortFallback(model: Model): Model {
  const supported = model.supportedEfforts ?? supportedEfforts(model.id);
  const baseline = model.effort ?? model.defaultEffort ?? defaultEffort(model.id);
  return {
    ...model,
    supportedEfforts: supported,
    defaultEffort: baseline && (!supported || supported.includes(baseline)) ? baseline : undefined,
  };
}

/** Lowest-cost reasoning effort known to be supported by a model. */
export function minimalEffort(model: string | Model): ReasoningEffort | undefined {
  const supported =
    typeof model === "string" ? supportedEfforts(model) : (model.supportedEfforts ?? supportedEfforts(model.id));
  if (!supported) return undefined;

  const ordered: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  return ordered.find((effort) => supported.includes(effort));
}

/**
 * Operational compaction budget, not the model's advertised context window.
 * Keep room for output and recovery and avoid expensive long-input tiers.
 * Deployments with smaller windows should set compactThreshold explicitly;
 * config, including 0 to disable compaction, wins at the call site.
 */
export function compactThreshold(id: string): number {
  const lowerId = normalizedModelId(id);
  if (/\bgpt-?4o\b|\bgpt-?4-turbo\b|\bo1\b/.test(lowerId)) return 100_000;
  if (/\bo[34]\b|\bhaiku\b|\bclaude-?[123]\b/.test(lowerId)) return 176_000;
  if (/\b(opus|sonnet)-?4(?:\.[0-5])?(?=$|[-/:])/.test(lowerId)) return 176_000;
  if (/\bgemini\b/.test(lowerId)) return 200_000;
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

  // Match the gateway's /render controls. GPT Image 2 has upstream transparent
  // output in preview, but the gateway currently only forwards it for Image 1.
  if (/\bgpt-?image-?2\b/.test(lowerId)) {
    return { qualities: ["low", "medium", "high"], aspectRatios: ["1:1", "3:2", "2:3", "16:9", "9:16"] };
  }
  if (/\bgpt-?image-?1\b/.test(lowerId)) {
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
    const resolutions: ImageResolution[] = /gemini-?3[.-]1-flash-image/.test(lowerId)
      ? ["512", "1K", "2K", "4K"]
      : /gemini-?3(?:[.-]1)?-(?:pro|flash)-image|nano-?banana-pro/.test(lowerId)
        ? ["1K", "2K", "4K"]
        : ["1K"];
    return {
      aspectRatios: ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
      resolutions,
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

// Endpoint cues, in precedence order. A live transcriber needs WebSocket, and a
// BGE reranker is not an embedder. Token boundaries avoid reading "clip" inside
// an unrelated deployment alias. Generic "audio" does not imply TTS: audio chat
// models also accept ordinary completion requests.
const MODEL_TYPE_CUES: [ModelType, RegExp][] = [
  [
    "realtime",
    /(?:^|[^a-z0-9])(?:realtime|sonic|live-preview|live-transcribe|transcribe-live|native-audio|gemini-live)(?:$|[^a-z0-9])/,
  ],
  ["reranker", /(?:^|[^a-z0-9])(?:rerank|reranker)(?:$|[^a-z0-9])/],
  ["embedder", /(?:^|[^a-z0-9])(?:embedding|embeddings|embed|bge|clip|gte|minilm)(?:$|[^a-z0-9])/],
  ["transcriber", /(?:^|[^a-z0-9])(?:stt|transcribe|whisper)(?:$|[^a-z0-9])/],
  ["synthesizer", /(?:^|[^a-z0-9])(?:tts|eleven|elevenlabs|mai-voice|stable-audio|speech)(?:$|[^a-z0-9])/],
  ["renderer", /(?:^|[^a-z0-9])(?:image|imagen|flux|dall-e|stable-diffusion|midjourney|nano-banana)(?:$|[^a-z0-9])/],
];

export function isModelType(value: unknown): value is ModelType {
  return value === "completer" || MODEL_TYPE_CUES.some(([type]) => type === value);
}

/** Best effort for APIs without type metadata; opaque aliases remain usable in chat. */
export function modelType(id: string): ModelType {
  const normalized = id.toLowerCase().replaceAll("_", "-");
  return MODEL_TYPE_CUES.find(([, pattern]) => pattern.test(normalized))?.[0] ?? "completer";
}

/** Optional gateway extensions to the standard /models record. */
export function modelFromAPI(model: { id: string; type?: unknown; name?: unknown; description?: unknown }): Model {
  return {
    id: model.id,
    type: isModelType(model.type) ? model.type : modelType(model.id),
    name: typeof model.name === "string" && model.name.trim() ? model.name : modelName(model.id),
    ...(typeof model.description === "string" && { description: model.description }),
  };
}

/** Config overrides API metadata before filtering, so opaque aliases can change endpoint type. */
export function configureModels(models: Model[], configured: Model[]): Model[] {
  const overrides = new Map(configured.map((model) => [model.id, model]));
  return models.map((model) => {
    const override = overrides.get(model.id);
    const resolved: Model = {
      ...model,
      ...override,
      name: override?.name || model.name,
      type: isModelType(override?.type) ? override.type : (model.type ?? modelType(model.id)),
    };
    if (resolved.type === "completer") return withEffortFallback(resolved);
    if (resolved.type === "renderer") return withRendererFallback(resolved);
    return resolved;
  });
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
