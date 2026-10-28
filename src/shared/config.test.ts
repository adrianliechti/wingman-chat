import { afterEach, expect, it, vi } from "vitest";
import { loadConfig } from "./config";
import { sameMcpServer, type McpServerDefinition } from "@/features/settings/lib/mcpConfig";

afterEach(() => vi.unstubAllGlobals());

async function loadWith(data: object) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
  vi.stubGlobal("window", { location: new URL("http://localhost") });
  const config = await loadConfig();
  expect(config).toBeDefined();
  return config!;
}

it("loads model feature defaults without enable configuration and preserves optional settings", async () => {
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
    renderer: { model: "image", disclaimer: "Please review", elicitation: true },
    vision: { model: "reader", files: ["image/png"], maxFileSize: 1000 },
  };
  expect(await loadWith(overrides)).toMatchObject(overrides);
});

it("requires explicit page flags without disabling service defaults", async () => {
  const defaults = await loadWith({ renderer: { model: "image" }, translator: { model: "chat" } });
  expect(defaults.canvasEnabled).toBe(false);
  expect(defaults.translatorEnabled).toBe(false);
  expect(defaults.renderer.model).toBe("image");
  expect(defaults.translator.model).toBe("chat");
  const enabled = await loadWith({ canvasEnabled: true, translatorEnabled: true });
  expect(enabled.canvasEnabled).toBe(true);
  expect(enabled.translatorEnabled).toBe(true);
  expect(enabled.extractor.files).toEqual([]);
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

it("normalizes configured endpoints and headers and retains companion wire compatibility", async () => {
  const config = await loadWith({
    bridge: { url: "http://LOCALHOST:4242/" },
    tools: [
      { id: "gateway", name: "Gateway", approval: { mode: "individual" } },
      { id: "legacy", name: "Legacy", needsApproval: true },
      { id: "invalid", name: "Invalid", approval: { mode: "always" } },
      { id: "direct", url: "https://MCP.test:443/api#ignored", headers: { "X-Tenant": " demo " } },
      { id: "direct", url: "https://duplicate.test" },
      { id: "bad", url: "file:///etc/passwd" },
      { id: "bad-header", url: "https://valid.test", headers: { Test: 42 } },
      { id: "companion", url: "https://collision.test" },
      { id: "../escape" },
    ],
  });
  expect(config.mcps).toEqual([
    {
      id: "gateway",
      source: "gateway",
      name: "Gateway",
      description: "",
      url: "http://localhost/api/v1/mcp/gateway",
      approval: { mode: "individual" },
    },
    {
      id: "direct",
      source: "configured",
      name: "direct",
      description: "",
      url: "https://mcp.test/api",
      headers: { "x-tenant": "demo" },
    },
  ]);
  expect(config.companion).toEqual({ url: "http://localhost:4242/" });
});

it("keeps the Internet provider ID while resolving its gateway research endpoint", async () => {
  const config = await loadWith({
    tools: [
      {
        id: "internet",
        name: "Web Search",
        description: "Access up-to-date information",
        url: "/api/v1/mcp/research",
        approval: { mode: "delegated" },
      },
    ],
  });
  expect(config.mcps).toEqual([
    {
      id: "internet",
      name: "Web Search",
      description: "Access up-to-date information",
      url: "http://localhost/api/v1/mcp/research",
      source: "configured",
      approval: { mode: "delegated" },
    },
  ]);
});

it.each([undefined, "none", "individual", "delegated"] as const)("loads MCP approval mode %s", async (mode) => {
  const approval = mode === undefined ? undefined : { mode };
  const config = await loadWith({ tools: [{ id: "test", approval }] });
  expect(config.mcps).toHaveLength(1);
  expect(config.mcps[0].approval).toEqual(approval);
});

it.each([null, "call", "prompt", {}, { mode: "call" }, { mode: true }, ["delegated"]])(
  "rejects malformed MCP approval rather than disabling approval: %j",
  async (approval) => {
    const config = await loadWith({ tools: [{ id: "invalid", approval }] });
    expect(config.mcps).toEqual([]);
  },
);

it("compares approval modes by value, treating omitted approval as none", () => {
  const server: McpServerDefinition = {
    id: "test",
    source: "configured",
    url: "https://example.test/mcp",
    name: "Test",
    description: "",
  };
  expect(sameMcpServer(server, { ...server, approval: { mode: "none" } })).toBe(true);
  expect(
    sameMcpServer({ ...server, approval: { mode: "delegated" } }, { ...server, approval: { mode: "delegated" } }),
  ).toBe(true);
  expect(
    sameMcpServer({ ...server, approval: { mode: "delegated" } }, { ...server, approval: { mode: "individual" } }),
  ).toBe(false);
});

it.each(["categories", "risks"])("preserves explicit IDs for chat.%s", async (kind) => {
  const items = [{ id: "stable_id", name: "Renamed label", description: "Criterion" }];
  const config = await loadWith({ chat: { [kind]: items } });
  expect(config.chat?.[kind as "categories" | "risks"]).toEqual(items);
});

it.each(["categories", "risks"])("rejects missing, blank, padded, or duplicate IDs in chat.%s", async (kind) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    vi.stubGlobal("window", { location: new URL("http://localhost") });
    for (const ids of [[undefined], [""], [" "], [" padded "], ["same", "same"]]) {
      const items = ids.map((id) => ({ id, name: "Label", description: "Criterion" }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ chat: { [kind]: items } })));
      expect(await loadConfig()).toBeUndefined();
    }
  } finally {
    error.mockRestore();
  }
});
