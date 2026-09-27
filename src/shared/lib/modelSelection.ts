import { getConfig } from "@/shared/config";
import { getModelCatalog } from "@/shared/lib/modelCatalog";
import { modelSupportsVision } from "@/shared/lib/models";
import type { Model, ModelType } from "@/shared/types/chat";

/**
 * The one selection rule for helper services (images, speech, transcription,
 * realtime): the configured id when set, otherwise the first catalog model of
 * the given type. Returns "" when neither exists; callers can report the service
 * as unavailable or use a backend default where supported.
 */
export function pickModel(models: readonly Model[], configured: string | undefined, type: ModelType): string {
  if (configured) return configured;
  return models.find((model) => model.type === type && !isLiveTranscriber(model, type))?.id ?? "";
}

// Live transcribers (gpt-live-transcribe, gemini-3.5-transcribe-live) are typed
// "realtime" but cannot hold a voice conversation, so never default to one.
function isLiveTranscriber(model: Model, type: ModelType): boolean {
  return type === "realtime" && /transcri/i.test(model.id);
}

/** Feature availability reflects services in the current backend inventory. */
export function getModelCapabilities(models: readonly Model[]) {
  return {
    vision: models.some(modelSupportsVision),
    renderer: !!pickModel(models, undefined, "renderer"),
    tts: !!pickModel(models, undefined, "synthesizer"),
    stt: !!pickModel(models, undefined, "transcriber"),
    voice: !!pickModel(models, undefined, "realtime"),
  };
}

/** `pickModel` against the shared catalog, for calls made outside React. */
export async function resolveModel(configured: string | undefined, type: ModelType): Promise<string> {
  if (configured) return configured;
  return pickModel(await loadModels(), configured, type);
}

/** Prefer a configured vision model, then the originating chat model, then an available vision model. */
export async function resolveVisionModel(configured?: string, preferred?: string | null): Promise<string> {
  const models = (await loadModels()).filter(modelSupportsVision);
  return (
    (configured
      ? models.find((model) => model.id === configured)
      : (models.find((model) => model.id === preferred) ?? models[0])
    )?.id ?? ""
  );
}

async function loadModels(): Promise<Model[]> {
  const config = getConfig();
  const catalog = getModelCatalog(config);
  return catalog.refresh().catch((error) => {
    // Keep working defaults during an outage after a successful inventory load.
    console.warn("Failed to list models for helper selection:", error);
    return catalog.getSnapshot() ?? [];
  });
}
