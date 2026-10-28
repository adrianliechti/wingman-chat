import { afterEach, expect, it, vi } from "vitest";
import { getModelCapabilities, pickModel, resolveModel, resolveVisionModel } from "./modelSelection";
import { fetchModelCatalog, MODEL_CATALOG_MAX_AGE_MS } from "@/shared/lib/modelCatalog";
import { queryClient } from "@/shared/lib/queryClient";
import type { Model } from "@/shared/types/chat";

const config = vi.hoisted(() => ({
  client: { listModels: vi.fn<() => Promise<Model[]>>() },
  models: [] as Model[],
}));
vi.mock("@/shared/config", () => ({ getConfig: () => config }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  queryClient.clear();
});

it("keeps the last successful helper model during a failed refresh", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  config.models = [];
  config.client.listModels.mockReset().mockResolvedValue([{ id: "image", name: "Image", type: "renderer" }]);
  expect(await resolveModel(undefined, "renderer")).toBe("image");
  vi.advanceTimersByTime(MODEL_CATALOG_MAX_AGE_MS);
  config.client.listModels.mockRejectedValue(new Error("offline"));
  expect(await resolveModel(undefined, "renderer")).toBe("image");
  config.client.listModels.mockResolvedValue([]);
  await fetchModelCatalog(config, true);
  expect(await resolveModel(undefined, "renderer")).toBe("");
});

it("selects capable vision models without substituting for an invalid explicit default", async () => {
  config.models = [];
  config.client.listModels.mockReset().mockResolvedValue([
    { id: "text", name: "Text", supportsVision: false },
    { id: "vision-a", name: "A", supportsVision: true },
    { id: "vision-b", name: "B", supportsVision: true },
  ]);
  expect(await resolveVisionModel()).toBe("vision-a");
  expect(await resolveVisionModel(undefined, "vision-b")).toBe("vision-b");
  expect(await resolveVisionModel("vision-a", "vision-b")).toBe("vision-a");
  expect(await resolveVisionModel(undefined, "text")).toBe("vision-a");
  expect(await resolveVisionModel("text", "vision-b")).toBe("");
  expect(await resolveVisionModel("missing")).toBe("");
});

it("requires an available model of the correct type for configured defaults", () => {
  const models: Model[] = [
    { id: "image", name: "Image", type: "renderer" },
    { id: "text", name: "Text", type: "completer" },
    { id: "live-transcribe", name: "Transcribe", type: "realtime" },
  ];
  expect(getModelCapabilities(models)).toEqual({ vision: false, renderer: true, tts: false, stt: false, voice: false });
  expect(getModelCapabilities(models, { renderer: { model: "missing" } }).renderer).toBe(false);
  expect(getModelCapabilities(models, { renderer: { model: "text" } }).renderer).toBe(false);
  expect(getModelCapabilities(models, { renderer: { model: "image" } }).renderer).toBe(true);
  expect(getModelCapabilities(models, { voice: { model: "live-transcribe" } }).voice).toBe(false);
});

it("shares configured aliases with the UI catalogue and replaces expired helper defaults", async () => {
  vi.useFakeTimers();
  config.models = [{ id: "alias", name: "Studio", type: "renderer" }];
  config.client.listModels.mockReset().mockResolvedValueOnce([{ id: "alias", name: "Alias", type: "completer" }]);
  await fetchModelCatalog(config);
  expect(await resolveModel(undefined, "renderer")).toBe("alias");
  expect(await resolveModel("alias", "renderer")).toBe("alias");
  expect(await resolveModel("missing", "renderer")).toBe("");
  expect(config.client.listModels).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(MODEL_CATALOG_MAX_AGE_MS);
  config.client.listModels.mockResolvedValueOnce([{ id: "new", name: "New", type: "renderer" }]);
  expect(await resolveModel(undefined, "renderer")).toBe("new");
  expect(await resolveModel(undefined, "transcriber")).toBe("");
});

it("prefers the configured id, then the first model of the type, then unavailable", () => {
  const models: Model[] = [
    { id: "chat", name: "Chat", type: "completer" },
    { id: "tts-a", name: "A", type: "synthesizer" },
    { id: "tts-b", name: "B", type: "synthesizer" },
  ];
  expect(pickModel(models, "tts-b", "synthesizer")).toBe("tts-b");
  expect(pickModel(models, "missing", "synthesizer")).toBe("");
  expect(pickModel(models, "chat", "synthesizer")).toBe("");
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

it("returns unavailable before the first successful catalog load", async () => {
  config.models = [];
  config.client.listModels.mockReset().mockRejectedValueOnce(new Error("offline"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(fetchModelCatalog(config, true)).rejects.toThrow("offline");
  config.client.listModels.mockRejectedValueOnce(new Error("offline"));
  expect(await resolveModel(undefined, "realtime")).toBe("");
});
