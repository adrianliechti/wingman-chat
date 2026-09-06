import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getConfig } from "@/shared/config";
import { getModelCatalog, MODEL_CATALOG_MAX_AGE_MS } from "@/shared/lib/modelCatalog";
import type { Model, ModelType } from "@/shared/types/chat";

const EMPTY_MODELS: Model[] = [];

/** Live backend inventory, with deployment overrides applied before type filtering. */
export function useModelCatalog(type?: ModelType) {
  const config = getConfig();
  const catalog = getModelCatalog(config);
  const models = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot, catalog.getSnapshot);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void catalog.refresh().catch((error) => console.error("Failed to refresh models:", error));
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, MODEL_CATALOG_MAX_AGE_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [catalog]);

  return useMemo(
    () => (type ? (models?.filter((model) => model.type === type) ?? EMPTY_MODELS) : (models ?? EMPTY_MODELS)),
    [models, type],
  );
}
