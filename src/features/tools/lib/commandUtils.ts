import { getConfig } from "@/shared/config";
import type { ModelType } from "@/shared/types/chat";

// Cache per model type — the backend's model list doesn't change within a session.
const resolvedModels = new Map<ModelType, Promise<string>>();

/**
 * Resolve the model for a helper: the configured id when set, otherwise the
 * first backend model of the given type (e.g. "synthesizer" for TTS). Returns
 * "" when the backend lists none — callers pass that through and let the
 * backend apply its own default.
 */
export function resolveModel(configured: string | undefined, type: ModelType): Promise<string> {
  if (configured) return Promise.resolve(configured);
  let pending = resolvedModels.get(type);
  if (!pending) {
    pending = getConfig()
      .client.listModels(type)
      .then((models) => models[0]?.id ?? "");
    // Drop failed lookups so a transient network error doesn't stick for the session.
    pending.catch(() => resolvedModels.delete(type));
    resolvedModels.set(type, pending);
  }
  return pending;
}
