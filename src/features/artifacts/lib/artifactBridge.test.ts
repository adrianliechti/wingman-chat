import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { emptyCapabilities } from "@/shared/lib/artifactSdk/protocol";
import type { Tool } from "@/shared/types/chat";
import { ArtifactBridge, resolveCapabilities } from "./artifactBridge";
import type { FileSystemManager, OverlayDelta } from "./fs";

vi.mock("@/shared/config", () => ({
  getConfig: () => ({ vision: { model: "v" }, extractor: null, translator: null, renderer: null, tts: null, stt: null, artifacts: {} }),
}));
vi.mock("@/features/tools/lib/llmCommand", () => ({ runLlm: vi.fn(async (prompt: string) => `echo:${prompt}`) }));
vi.mock("@/features/tools/lib/visionCommand", () => ({
  runVision: vi.fn(async (_data: Uint8Array, path: string, prompt?: string) => `saw ${path} ${prompt ?? ""}`.trim()),
}));
vi.mock("@/features/tools/lib/ocrCommand", () => ({ runOcr: vi.fn() }));
vi.mock("@/features/tools/lib/renderCommand", () => ({ runRenderImage: vi.fn() }));
vi.mock("@/features/tools/lib/synthesizeCommand", () => ({ runSynthesize: vi.fn() }));
vi.mock("@/features/tools/lib/transcribeCommand", () => ({ runTranscribe: vi.fn() }));
vi.mock("@/features/tools/lib/translateCommand", () => ({ runTranslateText: vi.fn(), runTranslateFile: vi.fn() }));
vi.mock("./duckdbWorkspace", () => ({ acquireDuckDbWorkspace: vi.fn() }));

const memory = new MemoryOpfs();

function fakeFs() {
  const files = new Map<string, { content: string; contentType?: string }>();
  const fs = {
    chatId: "chat",
    getFile: async (path: string) => {
      const file = files.get(path);
      return file ? { path, ...file } : undefined;
    },
    listEntries: async () => [...files.keys()].map((path) => ({ path })),
    fileExists: async (path: string) => files.has(path),
    applyOverlayDelta: async (delta: OverlayDelta) => {
      for (const [path, file] of Object.entries(delta.upserts)) files.set(path, file);
      for (const path of delta.deletes) files.delete(path);
      return { mutations: [] };
    },
  } as unknown as FileSystemManager;
  return { fs, files };
}

function bridge(overrides: Partial<ConstructorParameters<typeof ArtifactBridge>[0]> = {}) {
  const { fs, files } = fakeFs();
  const consent = vi.fn(async () => true);
  const tool: Tool = {
    name: "search",
    description: "search",
    parameters: { type: "object", properties: {} },
    function: vi.fn(async (args: Record<string, unknown>) => [{ type: "text" as const, text: `found ${JSON.stringify(args)}` }]),
  };
  const instance = new ArtifactBridge({
    fs,
    path: "/dash.html",
    capabilities: { ...emptyCapabilities(), llm: true, vision: true, files: true, store: true, tools: true },
    tools: () => [tool],
    consent,
    model: () => "m",
    ...overrides,
  });
  return { instance, files, consent, tool };
}

beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});
afterEach(() => vi.unstubAllGlobals());

describe("resolveCapabilities", () => {
  it("follows the configured services and the tool availability", () => {
    expect(resolveCapabilities(undefined, { tools: true })).toEqual({
      ...emptyCapabilities(),
      llm: true,
      vision: true,
      files: true,
      store: true,
      tools: true,
      duckdb: true,
    });
  });
});

describe("ArtifactBridge.dispatch", () => {
  it("reads and writes workspace files and remembers its own writes briefly", async () => {
    const { instance, files } = bridge();
    expect(await instance.dispatch("files.write", ["/out/data.json", '{"a":1}'])).toBe("/out/data.json");
    expect(files.get("/out/data.json")).toEqual({ content: '{"a":1}', contentType: "application/json" });
    expect(await instance.dispatch("files.readJSON", ["/out/data.json"])).toEqual({ a: 1 });
    expect(await instance.dispatch("files.write", ["/bytes.bin", new Uint8Array([1, 2, 3])])).toBe("/bytes.bin");
    expect(files.get("/bytes.bin")?.content).toMatch(/^data:application\/octet-stream;base64,/);
    expect(await instance.dispatch("files.read", ["/bytes.bin"])).toEqual(new Uint8Array([1, 2, 3]));
    expect(await instance.dispatch("files.list", [])).toEqual(["/out/data.json", "/bytes.bin"]);
    expect(instance.recentlyWrote("/out/data.json")).toBe(true);
    expect(instance.recentlyWrote("/other.txt")).toBe(false);
    expect(await instance.dispatch("files.remove", ["/bytes.bin"])).toBe(true);
    expect(await instance.dispatch("files.exists", ["/bytes.bin"])).toBe(false);
  });

  it("rejects reserved paths, unknown methods, and capabilities that are off", async () => {
    const { instance } = bridge();
    await expect(instance.dispatch("files.write", ["/__wingman__/sdk.js", "x"])).rejects.toThrow("reserved");
    await expect(instance.dispatch("nope", [])).rejects.toThrow("Unknown wingman method");
    await expect(instance.dispatch("ocr", ["/a.png"])).rejects.toThrow("not available");
    await expect(instance.dispatch("duckdb.query", [null, "select 1"])).rejects.toThrow("not available");
  });

  it("routes media helpers to the interpreter command runners", async () => {
    const { instance, files } = bridge();
    files.set("/photo.png", { content: "data:image/png;base64,AAAA", contentType: "image/png" });
    expect(await instance.dispatch("llm", ["hi", { system: "s" }])).toBe("echo:hi");
    expect(await instance.dispatch("vision", ["/photo.png", "what"])).toBe("saw /photo.png what");
  });

  it("keeps per-artifact state and hides reserved keys", async () => {
    const { instance } = bridge();
    expect(await instance.dispatch("store.get", ["filter"])).toBeNull();
    await instance.dispatch("store.set", ["filter", { region: "eu" }]);
    await instance.dispatch("store.set", ["page", 2]);
    expect(await instance.dispatch("store.get", ["filter"])).toEqual({ region: "eu" });
    expect(await instance.dispatch("store.keys", [])).toEqual(["filter", "page"]);
    await instance.dispatch("store.remove", ["page"]);
    expect(await instance.dispatch("store.keys", [])).toEqual(["filter"]);
    await expect(instance.dispatch("store.set", ["__wingman__/x", 1])).rejects.toThrow("reserved");
  });

  it("asks for consent once before calling tools and remembers the grant", async () => {
    const { instance, consent, tool } = bridge();
    expect(await instance.dispatch("tools.list", [])).toEqual([
      { name: "search", title: undefined, description: "search", parameters: { type: "object", properties: {} } },
    ]);
    expect(await instance.dispatch("tools.call", ["search", { q: "x" }])).toEqual([{ type: "text", text: 'found {"q":"x"}' }]);
    await instance.dispatch("tools.call", ["search", {}]);
    expect(consent).toHaveBeenCalledTimes(1);
    expect(consent).toHaveBeenCalledWith(["search"]);
    expect(tool.function).toHaveBeenCalledTimes(2);
    expect(await instance.dispatch("store.keys", [])).toEqual([]);
  });

  it("refuses tool calls the user declined and asks again next time", async () => {
    const consent = vi.fn(async () => false);
    const { instance, tool } = bridge({ consent });
    await expect(instance.dispatch("tools.call", ["search", {}])).rejects.toThrow("did not allow");
    await expect(instance.dispatch("tools.call", ["search", {}])).rejects.toThrow("did not allow");
    expect(consent).toHaveBeenCalledTimes(2);
    expect(tool.function).not.toHaveBeenCalled();
  });
});
