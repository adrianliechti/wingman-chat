import { getConfig } from "@/shared/config";
import { fetchModelCatalog, getModelCatalogSnapshot } from "@/shared/lib/modelCatalog";
import { modelSupportsVision } from "@/shared/lib/models";
import type { Model, ModelType } from "@/shared/types/chat";

/**
 * The one selection rule for helper services (images, speech, transcription,
 * realtime): the configured available id when set, otherwise the first catalog
 * model of the given type. Returns "" when no suitable model is available.
 */
export function pickModel(models: readonly Model[], configured: string | undefined, type: ModelType): string {
  return (
    models.find(
      (model) => (!configured || model.id === configured) && model.type === type && !isLiveTranscriber(model, type),
    )?.id ?? ""
  );
}

// Live transcribers (gpt-live-transcribe, gemini-3.5-transcribe-live) are typed
// "realtime" but cannot hold a voice conversation, so never default to one.
function isLiveTranscriber(model: Model, type: ModelType): boolean {
  return type === "realtime" && /transcri/i.test(model.id);
}

/** `pickModel` against the shared catalog, for calls made outside React. */
export async function resolveModel(configured: string | undefined, type: ModelType): Promise<string> {
  return pickModel(await loadModels(), configured, type);
}

const SERVICE_FEATURES = { renderer: "renderer", synthesizer: "tts", transcriber: "stt", realtime: "voice" } as const;
type FeatureDefaults = Partial<Pick<ReturnType<typeof getConfig>, "vision" | "renderer" | "tts" | "stt" | "voice">>;

/** Shared by controls, prompts, routes and the artifact SDK. */
export function getModelCapabilities(models: readonly Model[], config: FeatureDefaults = {}) {
  const available = (feature: keyof typeof SERVICE_FEATURES) => {
    return !!pickModel(models, config[SERVICE_FEATURES[feature]]?.model, feature);
  };
  return {
    vision: !!pickVisionModel(models, config.vision?.model),
    renderer: available("renderer"),
    tts: available("synthesizer"),
    stt: available("transcriber"),
    voice: available("realtime"),
  };
}

function pickVisionModel(models: readonly Model[], configured?: string, preferred?: string | null): string {
  const capable = models.filter(modelSupportsVision);
  return (
    (configured
      ? capable.find((model) => model.id === configured)
      : (capable.find((model) => model.id === preferred) ?? capable[0])
    )?.id ?? ""
  );
}

/** Prefer the configured model, then the capable originating chat model. */
export async function resolveVisionModel(configured?: string, preferred?: string | null): Promise<string> {
  return pickVisionModel(await loadModels(), configured, preferred);
}

export async function loadModels(): Promise<Model[]> {
  const config = getConfig();
  return fetchModelCatalog(config).catch((error) => {
    console.warn("Failed to refresh model inventory:", error);
    return getModelCatalogSnapshot(config) ?? [];
  });
}
