import { afterEach, expect, it, vi } from "vitest";
import { resolveModel } from "./commandUtils";
import { getModelCatalog, MODEL_CATALOG_MAX_AGE_MS } from "@/shared/lib/modelCatalog";
import type { Model } from "@/shared/types/chat";

const config = vi.hoisted(() => ({
  client: { listModels: vi.fn<() => Promise<Model[]>>() },
  models: [] as Model[],
}));
vi.mock("@/shared/config", () => ({ getConfig: () => config }));
afterEach(() => vi.useRealTimers());

it("shares configured aliases with the UI catalogue and replaces expired helper defaults", async () => {
  vi.useFakeTimers();
  config.models = [{ id: "alias", name: "Studio", type: "renderer" }];
  config.client.listModels.mockReset().mockResolvedValueOnce([{ id: "alias", name: "Alias", type: "completer" }]);
  await getModelCatalog(config).refresh();
  expect(await resolveModel(undefined, "renderer")).toBe("alias");
  expect(await resolveModel("explicit", "renderer")).toBe("explicit");
  expect(config.client.listModels).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(MODEL_CATALOG_MAX_AGE_MS);
  config.client.listModels.mockResolvedValueOnce([{ id: "new", name: "New", type: "renderer" }]);
  expect(await resolveModel(undefined, "renderer")).toBe("new");
  expect(await resolveModel(undefined, "transcriber")).toBe("");
});
