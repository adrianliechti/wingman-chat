import { queryOptions } from "@tanstack/react-query";
import type { Model } from "@/shared/types/chat";
import type { Client } from "./client";
import { configureModels } from "./models";
import { queryClient } from "./queryClient";

export const MODEL_CATALOG_MAX_AGE_MS = 60_000;
type ModelSource = Pick<Client, "listModels">;
interface CatalogConfig {
  client: ModelSource;
  models: Model[];
}

// Query keys must be serializable, so each backend client and configured model
// list gets a stable number; a replacement client or config is a new entry.
const identities = new WeakMap<object, number>();
let nextIdentity = 0;
function identity(value: unknown): number {
  // A missing or primitive config part shares one slot.
  if (!value || typeof value !== "object") return 0;
  let id = identities.get(value);
  if (id === undefined) {
    id = ++nextIdentity;
    identities.set(value, id);
  }
  return id;
}

/** The live backend inventory with deployment overrides applied, shared by pickers and helper calls. */
export function modelCatalogQuery({ client, models }: CatalogConfig) {
  return queryOptions({
    queryKey: ["models", identity(client), identity(models)] as const,
    queryFn: async () => configureModels(await client.listModels(), models),
    staleTime: MODEL_CATALOG_MAX_AGE_MS,
  });
}

/**
 * The catalog, fetched when missing or older than the max age (`force` ignores
 * the age). Concurrent calls share one request. A failed fetch rejects and
 * leaves the last successful list in the cache for the next attempt.
 */
export function fetchModelCatalog(config: CatalogConfig, force = false): Promise<Model[]> {
  const options = modelCatalogQuery(config);
  return queryClient.fetchQuery(force ? { ...options, staleTime: 0 } : options);
}

/** The last successful list, or null before the first success. */
export function getModelCatalogSnapshot(config: CatalogConfig): Model[] | null {
  return queryClient.getQueryData(modelCatalogQuery(config).queryKey) ?? null;
}
