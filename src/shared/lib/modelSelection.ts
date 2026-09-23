import { getConfig } from "@/shared/config";
import { getModelCatalog } from "@/shared/lib/modelCatalog";
import type { Model, ModelType } from "@/shared/types/chat";

/**
 * The one selection rule for helper services (images, speech, transcription,
 * realtime): the configured id when set, otherwise the first catalog model of
 * the given type. Returns "" when neither exists — callers pass that through
 * and the backend applies its own default.
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

/** `pickModel` against the shared catalog, for calls made outside React. */
export async function resolveModel(configured: string | undefined, type: ModelType): Promise<string> {
  if (configured) return configured;
  const config = getConfig();
  const models = await getModelCatalog(config)
    .refresh()
    .catch((error) => {
      // The catalog only picks a default; an unreachable /models must not
      // block the call itself, which can still use the backend default.
      console.warn(`Failed to list models for the ${type} default:`, error);
      return [];
    });
  return pickModel(models, configured, type);
}
