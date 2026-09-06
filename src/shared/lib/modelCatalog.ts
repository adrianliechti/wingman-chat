import type { Client } from "./client";
import type { Model } from "@/shared/types/chat";
import { configureModels } from "./models";

export const MODEL_CATALOG_MAX_AGE_MS = 60_000;
type ModelSource = Pick<Client, "listModels">;
interface CatalogConfig {
  client: ModelSource;
  models: Model[];
}

/** One bounded cache per backend client, shared by pickers and helper calls. */
class ModelCatalog {
  private models: Model[] | null = null;
  private updatedAt = -Infinity;
  private pending: Promise<Model[]> | undefined;
  private listeners = new Set<() => void>();

  private readonly client: ModelSource;
  private readonly configured: Model[];

  constructor(client: ModelSource, configured: Model[]) {
    this.client = client;
    this.configured = configured;
  }

  getSnapshot = () => this.models;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  refresh = (force = false): Promise<Model[]> => {
    if (this.pending) return this.pending;
    if (!force && this.models !== null && Date.now() - this.updatedAt < MODEL_CATALOG_MAX_AGE_MS) {
      return Promise.resolve(this.models);
    }
    this.pending = Promise.resolve()
      .then(() => this.client.listModels())
      .then((apiModels) => {
        const models = configureModels(apiModels, this.configured);
        this.models = models;
        this.updatedAt = Date.now();
        for (const listener of this.listeners) listener();
        return models;
      })
      .finally(() => {
        this.pending = undefined;
      });
    // A failed refresh rejects to its caller and leaves the last successful
    // snapshot intact. The next refresh can retry, including after initial failure.
    return this.pending;
  };
}

const catalogs = new WeakMap<ModelSource, { configured: Model[]; catalog: ModelCatalog }>();

export function getModelCatalog({ client, models }: CatalogConfig): ModelCatalog {
  let entry = catalogs.get(client);
  if (!entry || entry.configured !== models) {
    entry = { configured: models, catalog: new ModelCatalog(client, models) };
    catalogs.set(client, entry);
  }
  return entry.catalog;
}
