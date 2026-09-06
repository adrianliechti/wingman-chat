import { getConfig } from "@/shared/config";
import { getModelCatalog } from "@/shared/lib/modelCatalog";
import type { ModelType } from "@/shared/types/chat";

/**
 * Resolve the model for a helper: the configured id when set, otherwise the
 * first backend model of the given type (e.g. "renderer" for images). Returns
 * "" when the backend lists none — callers pass that through and let the
 * backend apply its own default.
 */
export async function resolveModel(configured: string | undefined, type: ModelType): Promise<string> {
  if (configured) return configured;
  const config = getConfig();
  const models = await getModelCatalog(config).refresh();
  return models.find((model) => model.type === type)?.id ?? "";
}
