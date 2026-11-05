import { beforeEach, expect, it, vi } from "vitest";
import { runRetouch } from "./retouch";
import { DEFAULTS } from "./recipe";
import type { Image } from "../types/canvas";
import type { Selection } from "./mask";
import type { Model } from "@/shared/types/chat";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), decode: vi.fn(), selected: vi.fn(), mask: vi.fn() }));
vi.mock("@/shared/config", () => ({ getConfig: () => ({ client: { generateImage: mocks.generate } }) }));
vi.mock("./exportImage", () => ({ decodeCanvas: mocks.decode }));
vi.mock("./mask", () => ({ hasSelectedPixels: mocks.selected, selectionToMask: mocks.mask }));

const model: Model = { id: "painter", name: "Painter", type: "renderer", supportedAspectRatios: ["1:1", "3:2"] };
const image: Image = {
  id: "photo",
  data: "data:image/jpeg;base64,AQ==",
  created: null,
  updated: null,
  prompt: "",
  model: "",
  versions: [],
  recipe: DEFAULTS,
};
const selection = { width: 600, height: 400 } as Selection;
let source: Blob;
let mask: Blob;

beforeEach(() => {
  vi.resetAllMocks();
  source = new Blob(["source"], { type: "image/png" });
  mask = new Blob(["mask"], { type: "image/png" });
  mocks.decode.mockResolvedValue({ width: 600, height: 400, convertToBlob: async () => source });
  mocks.mask.mockResolvedValue(mask);
  mocks.generate.mockResolvedValue(new Blob(["result"], { type: "image/png" }));
});

it("sends a normalized source, a matching mask and the source aspect", async () => {
  mocks.selected.mockReturnValue(true);
  await runRetouch(model, image, { kind: "replace", prompt: "a bicycle" }, selection);
  expect(mocks.mask).toHaveBeenCalledWith(selection, 600, 400);
  expect(mocks.generate).toHaveBeenCalledWith("painter", expect.stringContaining("a bicycle"), [source], {
    mask,
    aspectRatio: "3:2",
  });
});

it("rejects missing or erased selections before decoding or making an AI request", async () => {
  mocks.selected.mockReturnValue(false);
  await expect(runRetouch(model, image, { kind: "remove" }, selection)).rejects.toThrow("Select an area");
  await expect(runRetouch(model, image, { kind: "remove" }, null)).rejects.toThrow("Select an area");
  expect(mocks.decode).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("omits a background mask when there is no selected subject", async () => {
  mocks.selected.mockReturnValue(false);
  await runRetouch(model, image, { kind: "replaceBackground", prompt: "a beach" }, selection);
  expect(mocks.mask).not.toHaveBeenCalled();
  expect(mocks.generate.mock.calls[0][3]).toEqual({ aspectRatio: "3:2" });
});

it("protects a selected subject when replacing its background", async () => {
  mocks.selected.mockReturnValue(true);
  await runRetouch(model, image, { kind: "replaceBackground", prompt: "a beach" }, selection);
  expect(mocks.mask).toHaveBeenCalledWith(selection, 600, 400, true);
});

it("does not force an unrelated aspect and rejects empty instructions", async () => {
  await runRetouch(
    { ...model, supportedAspectRatios: ["1:1"] },
    image,
    { kind: "edit", prompt: "warm lighting" },
    null,
  );
  expect(mocks.generate.mock.calls[0][3]).toEqual({});
  await expect(runRetouch(model, image, { kind: "edit", prompt: "  " }, null)).rejects.toThrow("Describe the change");
});
