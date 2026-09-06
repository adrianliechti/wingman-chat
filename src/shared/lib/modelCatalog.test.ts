import { afterEach, expect, it, vi } from "vitest";
import { getModelCatalog, MODEL_CATALOG_MAX_AGE_MS } from "./modelCatalog";
import type { Model } from "@/shared/types/chat";

afterEach(() => vi.useRealTimers());

function fixture(models: Model[] = []) {
  const listModels = vi.fn<() => Promise<Model[]>>();
  const config = { client: { listModels }, models };
  return { config, listModels, catalog: getModelCatalog(config) };
}

it("coalesces consumers and resolves config types and capabilities in the shared snapshot", async () => {
  const { config, catalog, listModels } = fixture([{ id: "alias", name: "Studio", type: "renderer" }]);
  let resolve!: (models: Model[]) => void;
  listModels.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const first = catalog.refresh();
  expect(catalog.refresh(true)).toBe(first);
  expect(getModelCatalog(config)).toBe(catalog);
  expect(catalog.getSnapshot()).toBeNull();
  await Promise.resolve();
  expect(listModels).toHaveBeenCalledExactlyOnceWith();
  resolve([{ id: "alias", name: "API name", type: "completer" }]);
  expect(await first).toMatchObject([
    { id: "alias", name: "Studio", type: "renderer", supportedQualities: ["low", "medium", "high"] },
  ]);
  expect(await catalog.refresh()).toBe(catalog.getSnapshot());
  expect(listModels).toHaveBeenCalledTimes(1);
});

it("expires its cache, accepts removals and caches a successful empty inventory", async () => {
  vi.useFakeTimers();
  const { catalog, listModels } = fixture();
  listModels.mockResolvedValueOnce([{ id: "old", name: "Old" }]).mockResolvedValueOnce([]);
  const first = await catalog.refresh();
  vi.advanceTimersByTime(MODEL_CATALOG_MAX_AGE_MS - 1);
  expect(await catalog.refresh()).toBe(first);
  vi.advanceTimersByTime(1);
  expect(await catalog.refresh()).toEqual([]);
  expect(await catalog.refresh()).toEqual([]);
  expect(listModels).toHaveBeenCalledTimes(2);
});

it("keeps the last successful list on failure and allows an immediate retry", async () => {
  const { catalog, listModels } = fixture();
  listModels.mockResolvedValueOnce([{ id: "old", name: "Old" }]);
  const good = await catalog.refresh();
  listModels.mockRejectedValueOnce(new Error("Offline"));
  await expect(catalog.refresh(true)).rejects.toThrow("Offline");
  expect(catalog.getSnapshot()).toBe(good);
  listModels.mockResolvedValueOnce([{ id: "new", name: "New" }]);
  expect(await catalog.refresh(true)).toMatchObject([{ id: "new" }]);
});

it("recovers from an initial error without caching a false empty success", async () => {
  const { catalog, listModels } = fixture();
  listModels.mockImplementationOnce(() => {
    throw new Error("Unavailable");
  });
  await expect(catalog.refresh()).rejects.toThrow("Unavailable");
  expect(catalog.getSnapshot()).toBeNull();
  listModels.mockResolvedValueOnce([]);
  expect(await catalog.refresh()).toEqual([]);
});

it("isolates replacement backend clients and config from an older pending request", async () => {
  const { config, catalog, listModels } = fixture();
  let resolve!: (models: Model[]) => void;
  listModels.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const old = catalog.refresh();
  const replacement = fixture();
  replacement.listModels.mockResolvedValueOnce([{ id: "current", name: "Current" }]);
  const current = await replacement.catalog.refresh();
  resolve([{ id: "obsolete", name: "Obsolete" }]);
  await old;
  expect(replacement.catalog.getSnapshot()).toBe(current);
  const newConfig = { ...config, models: [{ id: "opaque", name: "Image", type: "renderer" as const }] };
  expect(getModelCatalog(newConfig)).not.toBe(catalog);
});

it("notifies subscribers only on success and stops notifying after unsubscribe", async () => {
  const { catalog, listModels } = fixture();
  const listener = vi.fn();
  const unsubscribe = catalog.subscribe(listener);
  listModels.mockResolvedValue([]);
  await catalog.refresh();
  expect(listener).toHaveBeenCalledTimes(1);
  listModels.mockRejectedValueOnce(new Error("Offline"));
  await expect(catalog.refresh(true)).rejects.toThrow("Offline");
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  await catalog.refresh(true);
  expect(listener).toHaveBeenCalledTimes(1);
});
