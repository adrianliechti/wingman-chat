import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import type { Model } from "@/shared/types/chat";

/**
 * Loads the available renderer (image) models with their capabilities resolved:
 * a matching config entry overrides per model, then a per-family heuristic fills
 * any gaps (quality tiers, aspect ratios, background modes). This is the renderer
 * analogue of useModels' reasoning-effort handling and drives the Canvas pickers.
 */
export function useRendererModels(): Model[] {
  return useModelCatalog("renderer");
}
