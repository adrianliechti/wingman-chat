import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { useImageTool } from "./useImageTool";
import type { Model } from "@/shared/types/chat";

const config = vi.hoisted(() => ({
  client: { generateImage: vi.fn(async (..._args: unknown[]) => new Blob(["image"], { type: "image/png" })) },
  renderer: { model: "gpt-image-2" } as { model?: string; elicitation?: boolean },
  models: [] as Model[],
}));
vi.mock("@/shared/config", () => ({ getConfig: () => config }));
// Stands in for the live catalog, which already applies config.models overrides.
vi.mock("@/shared/hooks/useModelCatalog", () => ({ useModelCatalog: () => config.models }));
vi.mock("@/features/artifacts/hooks/useArtifacts", () => ({ useArtifacts: () => ({ fs: null }) }));
vi.mock("@/shared/lib/utils", () => ({ readAsDataURL: async () => "data:image/png;base64,aW1hZ2U=" }));

beforeEach(() => {
  config.renderer = { model: "gpt-image-2" };
  config.models = [];
  config.client.generateImage.mockReset().mockResolvedValue(new Blob(["image"], { type: "image/png" }));
});

function buildTool() {
  let tool!: ReturnType<typeof useImageTool>;
  function Harness() {
    tool = useImageTool();
    return null;
  }
  renderToString(<Harness />);
  return tool!;
}

function parameters() {
  return buildTool().parameters.properties as Record<string, { enum?: string[] }>;
}

it("advertises the gateway image controls with config overrides, including disabled controls", () => {
  config.models = [];
  expect(parameters().aspect_ratio.enum).toContain("16:9");
  expect(parameters().background).toBeUndefined();
  config.models = [
    {
      id: "gpt-image-2",
      name: "Image",
      supportedQualities: [],
      supportedAspectRatios: [],
      supportedBackgrounds: ["transparent"],
    },
  ];
  const properties = parameters();
  expect(properties.quality).toBeUndefined();
  expect(properties.aspect_ratio).toBeUndefined();
  expect(properties.background.enum).toEqual(["transparent"]);
});

it("sends a configured supported quality instead of defaulting to unsupported low", async () => {
  config.models = [{ id: "gpt-image-2", name: "Image", supportedQualities: ["medium", "high"] }];
  const result = await buildTool().function({ prompt: "A test image" });
  expect(result).toMatchObject([{ type: "image" }]);
  expect(config.client.generateImage.mock.calls.at(-1)?.[3]).toMatchObject({ quality: "medium" });
});

it("falls back to the first catalog renderer when none is configured", async () => {
  config.renderer = {};
  config.models = [
    { id: "chat", name: "Chat", type: "completer" },
    { id: "flux", name: "Flux", type: "renderer", supportedQualities: [] },
  ];
  expect(parameters().quality).toBeUndefined();
  await buildTool().function({ prompt: "A test image" });
  expect(config.client.generateImage.mock.calls.at(-1)?.[0]).toBe("flux");
});

it("marks renderer failures as tool errors instead of displaying a successful creation", async () => {
  config.client.generateImage.mockRejectedValueOnce(new Error("Renderer unavailable"));
  const setError = vi.fn();
  const result = await buildTool().function({ prompt: "A test image" }, { setError });
  expect(result).toEqual([{ type: "text", text: expect.stringContaining("Renderer unavailable") }]);
  expect(setError).toHaveBeenCalledWith(expect.objectContaining({ code: "IMAGE_GENERATION_ERROR" }));
});

it("honors configured confirmation even in a context without an elicitation handler", async () => {
  config.renderer.elicitation = true;
  const result = await buildTool().function({ prompt: "A test image" });
  expect(config.client.generateImage).not.toHaveBeenCalled();
  expect(result).toEqual([{ type: "text", text: expect.stringContaining("confirmation") }]);
});

it("does not generate an image when the user declines confirmation", async () => {
  config.renderer.elicitation = true;
  const elicit = vi.fn().mockResolvedValue({ action: "decline" });
  await buildTool().function({ prompt: "A test image" }, { elicit });
  expect(elicit).toHaveBeenCalledOnce();
  expect(config.client.generateImage).not.toHaveBeenCalled();
});

it("forwards current-message image attachments to the renderer", async () => {
  await buildTool().function(
    { prompt: "Edit this image" },
    {
      content: () => [{ type: "image", data: "data:image/png;base64,cmVmZXJlbmNl" }],
    },
  );
  const references = config.client.generateImage.mock.calls[0][2] as Blob[];
  expect(references).toHaveLength(1);
  expect(await references[0].text()).toBe("reference");
});

it("does not publish a late image result after cancellation", async () => {
  const controller = new AbortController();
  config.client.generateImage.mockImplementationOnce(async () => {
    controller.abort();
    return new Blob(["image"], { type: "image/png" });
  });
  await expect(buildTool().function({ prompt: "A test image" }, { signal: controller.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
});
