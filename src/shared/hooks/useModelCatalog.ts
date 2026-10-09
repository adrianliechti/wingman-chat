import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getConfig } from "@/shared/config";
import { MODEL_CATALOG_MAX_AGE_MS, modelCatalogQuery } from "@/shared/lib/modelCatalog";
import { queryClient } from "@/shared/lib/queryClient";
import type { Model, ModelType } from "@/shared/types/chat";

const EMPTY_MODELS: Model[] = [];

/**
 * Live backend inventory, with deployment overrides applied before type
 * filtering. Refreshes on focus, on reconnect and on a schedule while the tab
 * is visible; a failed refresh keeps the last successful list.
 */
export function useModelCatalog(type?: ModelType) {
  const config = getConfig();
  const { data } = useQuery(
    { ...modelCatalogQuery(config), refetchInterval: MODEL_CATALOG_MAX_AGE_MS, refetchIntervalInBackground: false },
    queryClient,
  );

  return useMemo(
    () => (type ? (data?.filter((model) => model.type === type) ?? EMPTY_MODELS) : (data ?? EMPTY_MODELS)),
    [data, type],
  );
}
