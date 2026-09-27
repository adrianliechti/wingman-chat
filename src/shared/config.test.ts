import { afterEach, expect, it, vi } from "vitest";
import { loadConfig } from "./config";

afterEach(() => vi.unstubAllGlobals());

async function loadWith(data: object) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
  vi.stubGlobal("window", { location: new URL("http://localhost") });
  const config = await loadConfig();
  expect(config).toBeDefined();
  return config!;
}

it.each([undefined, true, false])("loads enableCustomMCP=%s without changing other MCP sources", async (enabled) => {
  const tool = { id: "configured", name: "Configured", description: "Deployment MCP" };
  const bridge = { url: "http://localhost:3000" };
  const plugins = { url: "https://plugins.example.com" };
  const config = await loadWith({ enableCustomMCP: enabled, tools: [tool], bridge, plugins });

  expect(config.enableCustomMCP).toBe(enabled !== false);
  expect(config.mcps).toEqual([{ ...tool, url: "http://localhost/api/v1/mcp/configured" }]);
  expect(config.bridge).toEqual(bridge);
  expect(config.plugins).toEqual(plugins);
});

it("provides speech defaults without enable config and keeps optional overrides", async () => {
  const defaults = await loadWith({});
  expect(defaults.tts.voices).toMatchObject({ narrator: "alloy" });
  expect(defaults.stt).toEqual({});
  expect(defaults.voice).toEqual({});
  expect(defaults.renderer).toEqual({});
  expect(defaults.vision.files).toEqual(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  const overrides = {
    tts: { model: "speaker", voices: { narrator: "custom" } },
    stt: { model: "dictation", format: "wav" },
    voice: { model: "conversation", transcriber: "live-transcription" },
    renderer: { model: "image" },
    vision: { model: "reader", files: ["image/png"], maxFileSize: 1000 },
  };
  expect(await loadWith(overrides)).toMatchObject(overrides);
});

it("loads an ordered list of account links and hides entries without destinations", async () => {
  const config = await loadWith({
    links: [
      { title: "Docs", url: "https://example.com/docs", icon: "docs" },
      { title: "Hidden", url: " " },
      { title: "Missing" },
      { title: "Community", description: "Talk to the team", url: "https://example.com/community", icon: "community" },
      { title: " ", url: " https://example.com/other " },
    ],
  });
  expect(config.links).toEqual([
    { title: "Docs", url: "https://example.com/docs", icon: "docs" },
    { title: "Community", description: "Talk to the team", url: "https://example.com/community", icon: "community" },
    { title: "https://example.com/other", url: "https://example.com/other" },
  ]);
});

it("preserves the labels and icons of legacy support and cost links", async () => {
  const config = await loadWith({
    support: { title: "Learning Hub", description: "Guides", url: "https://example.com/support" },
    cost: { title: " ", url: "https://example.com/cost" },
  });
  expect(config.links).toEqual([
    { title: "Learning Hub", description: "Guides", url: "https://example.com/support", icon: "learning" },
    { title: "Cost Dashboard", url: "https://example.com/cost", icon: "cost" },
  ]);
});

it.each([{ links: [] }, { links: [{ title: "Docs", url: "https://example.com/docs" }] }])(
  "uses an explicit links array instead of legacy entries: $links",
  async ({ links }) => {
    const config = await loadWith({
      links,
      support: { url: "https://example.com/support" },
      cost: { url: "https://example.com/cost" },
    });
    expect(config.links).toEqual(links);
  },
);

it("shows no links when none are configured", async () => {
  expect((await loadWith({})).links).toEqual([]);
});
