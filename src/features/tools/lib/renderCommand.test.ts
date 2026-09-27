import { beforeEach, expect, it, vi } from "vitest";
import type { Model } from "@/shared/types/chat";
import { runRenderImage } from "./renderCommand";

const config = vi.hoisted(() => ({
  renderer: undefined as { model: string } | undefined,
  models: [] as Model[],
  client: {
    listModels: vi.fn<() => Promise<Model[]>>(),
    generateImage: vi.fn(async (..._args: unknown[]) => new Blob(["image"], { type: "image/png" })),
  },
}));
vi.mock("@/shared/config", () => ({ getConfig: () => config }));

beforeEach(() => {
  config.renderer = undefined;
  config.models = [];
  config.client.listModels.mockReset().mockResolvedValue([{ id: "gpt-image-2", name: "Image", type: "renderer" }]);
  config.client.generateImage.mockClear();
});

it("renders using a discovered model without renderer config", async () => {
  const controller = new AbortController();
  const result = await runRenderImage("Draw a tree", [], { quality: "high" }, { signal: controller.signal });
  expect(new TextDecoder().decode(result)).toBe("image");
  expect(config.client.generateImage).toHaveBeenCalledWith(
    "gpt-image-2",
    "Draw a tree",
    [],
    { quality: "high" },
    { signal: controller.signal },
  );
});

it("keeps an optional model override", async () => {
  config.renderer = { model: "preferred" };
  await runRenderImage("Draw a tree", []);
  expect(config.client.generateImage.mock.calls[0][0]).toBe("preferred");
});

it("does not dispatch to an unavailable renderer or after cancellation", async () => {
  config.client.listModels.mockResolvedValue([]);
  await expect(runRenderImage("Draw a tree", [])).rejects.toThrow("no image rendering model available");
  const controller = new AbortController();
  controller.abort();
  await expect(runRenderImage("Draw a tree", [], undefined, { signal: controller.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(config.client.generateImage).not.toHaveBeenCalled();
});
