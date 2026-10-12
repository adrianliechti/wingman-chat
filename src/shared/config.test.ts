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
      { id: "gateway", name: "Gateway", needsApproval: true },
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
      needsApproval: true,
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
        needsApproval: true,
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
      needsApproval: true,
    },
  ]);
});
