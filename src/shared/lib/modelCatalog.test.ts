import { afterEach, expect, it, vi } from "vitest";
import type { Model } from "@/shared/types/chat";
import {
  fetchModelCatalog,
  getModelCatalogSnapshot,
  MODEL_CATALOG_MAX_AGE_MS,
  modelCatalogQuery,
} from "./modelCatalog";
import { queryClient } from "./queryClient";

afterEach(() => {
  vi.useRealTimers();
  queryClient.clear();
});

function fixture(models: Model[] = []) {
  const listModels = vi.fn<() => Promise<Model[]>>();
  const config = { client: { listModels }, models };
  return { config, listModels };
}

it("coalesces consumers and resolves config types and capabilities in the shared snapshot", async () => {
  const { config, listModels } = fixture([{ id: "alias", name: "Studio", type: "renderer" }]);
  let resolve!: (models: Model[]) => void;
  listModels.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const first = fetchModelCatalog(config);
  const second = fetchModelCatalog(config, true);
  expect(modelCatalogQuery(config).queryKey).toEqual(modelCatalogQuery(config).queryKey);
  expect(getModelCatalogSnapshot(config)).toBeNull();
  await Promise.resolve();
  expect(listModels).toHaveBeenCalledExactlyOnceWith();
  resolve([{ id: "alias", name: "API name", type: "completer" }]);
  expect(await first).toMatchObject([
    { id: "alias", name: "Studio", type: "renderer", supportedQualities: ["low", "medium", "high"] },
  ]);
  expect(await second).toBe(await first);
  expect(await fetchModelCatalog(config)).toBe(getModelCatalogSnapshot(config));
  expect(listModels).toHaveBeenCalledTimes(1);
});

it("expires its cache, accepts removals and caches a successful empty inventory", async () => {
  vi.useFakeTimers();
  const { config, listModels } = fixture();
  listModels.mockResolvedValueOnce([{ id: "old", name: "Old" }]).mockResolvedValueOnce([]);
  const first = await fetchModelCatalog(config);
  vi.advanceTimersByTime(MODEL_CATALOG_MAX_AGE_MS - 1);
  expect(await fetchModelCatalog(config)).toBe(first);
  vi.advanceTimersByTime(1);
  expect(await fetchModelCatalog(config)).toEqual([]);
  expect(await fetchModelCatalog(config)).toEqual([]);
  expect(listModels).toHaveBeenCalledTimes(2);
});

it("keeps the last successful list on failure and allows an immediate retry", async () => {
  const { config, listModels } = fixture();
  listModels.mockResolvedValueOnce([{ id: "old", name: "Old" }]);
  const good = await fetchModelCatalog(config);
  listModels.mockRejectedValueOnce(new Error("Offline"));
  await expect(fetchModelCatalog(config, true)).rejects.toThrow("Offline");
  expect(getModelCatalogSnapshot(config)).toBe(good);
  listModels.mockResolvedValueOnce([{ id: "new", name: "New" }]);
  expect(await fetchModelCatalog(config, true)).toMatchObject([{ id: "new" }]);
});

it("recovers from an initial error without caching a false empty success", async () => {
  const { config, listModels } = fixture();
  listModels.mockImplementationOnce(() => {
    throw new Error("Unavailable");
  });
  await expect(fetchModelCatalog(config)).rejects.toThrow("Unavailable");
  expect(getModelCatalogSnapshot(config)).toBeNull();
  listModels.mockResolvedValueOnce([]);
  expect(await fetchModelCatalog(config)).toEqual([]);
});

it("isolates replacement backend clients and config from an older pending request", async () => {
  const { config, listModels } = fixture();
  let resolve!: (models: Model[]) => void;
  listModels.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const old = fetchModelCatalog(config);
  const replacement = fixture();
  replacement.listModels.mockResolvedValueOnce([{ id: "current", name: "Current" }]);
  const current = await fetchModelCatalog(replacement.config);
  resolve([{ id: "obsolete", name: "Obsolete" }]);
  await old;
  expect(getModelCatalogSnapshot(replacement.config)).toBe(current);
  const newConfig = { ...config, models: [{ id: "opaque", name: "Image", type: "renderer" as const }] };
  expect(modelCatalogQuery(newConfig).queryKey).not.toEqual(modelCatalogQuery(config).queryKey);
  expect(getModelCatalogSnapshot(newConfig)).toBeNull();
});
