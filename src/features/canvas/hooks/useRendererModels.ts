import { useMemo } from "react";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import { isSongModel } from "@/shared/lib/models";
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

/**
 * Everything Canvas can create with: the renderers for images and video, then
 * the music models. Those are synthesizers to the backend, which serves songs
 * on its speech endpoint, so they come from the same catalog under another type.
 */
export function useCanvasModels(): Model[] {
  const renderers = useRendererModels();
  const synthesizers = useModelCatalog("synthesizer");
  return useMemo(() => [...renderers, ...synthesizers.filter(isSongModel)], [renderers, synthesizers]);
}
