import { afterEach, expect, it, vi } from "vitest";
import { pickModel, resolveModel } from "./modelSelection";
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

it("prefers the configured id, then the first model of the type, then the backend default", () => {
  const models: Model[] = [
    { id: "chat", name: "Chat", type: "completer" },
    { id: "tts-a", name: "A", type: "synthesizer" },
    { id: "tts-b", name: "B", type: "synthesizer" },
  ];
  expect(pickModel(models, "explicit", "synthesizer")).toBe("explicit");
  expect(pickModel(models, undefined, "synthesizer")).toBe("tts-a");
  expect(pickModel(models, "", "transcriber")).toBe("");
});

it("never defaults voice to a transcription-only live model", () => {
  const models: Model[] = [
    { id: "gpt-live-transcribe", name: "Transcribe", type: "realtime" },
    { id: "gemini-3.5-transcribe-live", name: "Gemini Transcribe", type: "realtime" },
    { id: "gpt-realtime-2.1", name: "Realtime", type: "realtime" },
  ];
  expect(pickModel(models, undefined, "realtime")).toBe("gpt-realtime-2.1");
  expect(pickModel(models.slice(0, 2), undefined, "realtime")).toBe("");
});

it("falls back to the backend default when the catalogue is unreachable", async () => {
  config.models = [];
  config.client.listModels.mockReset().mockRejectedValueOnce(new Error("offline"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(getModelCatalog(config).refresh(true)).rejects.toThrow("offline");
  config.client.listModels.mockRejectedValueOnce(new Error("offline"));
  expect(await resolveModel(undefined, "realtime")).toBe("");
});
