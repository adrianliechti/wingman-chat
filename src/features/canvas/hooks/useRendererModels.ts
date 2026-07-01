import { useEffect, useState } from "react";
import { getConfig } from "@/shared/config";
import { withRendererFallback } from "@/shared/lib/models";
import type { Model } from "@/shared/types/chat";

/**
 * Loads the available renderer (image) models with their capabilities resolved:
 * a matching config entry overrides per model, then a per-family heuristic fills
 * any gaps (quality tiers, aspect ratios, background modes). This is the renderer
 * analogue of useModels' reasoning-effort handling and drives the Canvas pickers.
 */
export function useRendererModels(): Model[] {
  const config = getConfig();
  const [models, setModels] = useState<Model[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const apiModels = await config.client.listModels("renderer");
        const configById = new Map(config.models.map((m) => [m.id, m]));

        const resolved = apiModels.map((model) => {
          const override = configById.get(model.id);
          const merged: Model = override
            ? {
                ...model,
                name: override.name || model.name,
                description: override.description ?? model.description,
                supportedQualities: override.supportedQualities ?? model.supportedQualities,
                supportedAspectRatios: override.supportedAspectRatios ?? model.supportedAspectRatios,
                supportedResolutions: override.supportedResolutions ?? model.supportedResolutions,
                supportedBackgrounds: override.supportedBackgrounds ?? model.supportedBackgrounds,
              }
            : model;
          return withRendererFallback(merged);
        });

        if (!cancelled) setModels(resolved);
      } catch (error) {
        console.error("Failed to load renderer models:", error);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [config.client, config.models]);

  return models;
}
