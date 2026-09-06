import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { useImageTool } from "./useImageTool";
import type { Model } from "@/shared/types/chat";

const config = vi.hoisted(() => ({
  client: { generateImage: vi.fn(async (..._args: unknown[]) => new Blob(["image"], { type: "image/png" })) },
  renderer: { model: "gpt-image-2" },
  models: [] as Model[],
}));
vi.mock("@/shared/config", () => ({ getConfig: () => config }));
vi.mock("@/features/artifacts/hooks/useArtifacts", () => ({ useArtifacts: () => ({ fs: null }) }));
vi.mock("@/shared/lib/utils", () => ({ readAsDataURL: async () => "data:image/png;base64,aW1hZ2U=" }));

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
