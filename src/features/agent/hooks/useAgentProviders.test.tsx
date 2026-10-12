// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePluginProviders, type PluginProviders } from "@/features/plugins/hooks/usePluginProviders";
import { pluginMcpClientId, pluginProviderId } from "@/features/plugins/lib/pluginProvider";
import type { InstalledPlugin } from "@/features/plugins/lib/types";
import type { Agent } from "../types/agent";
import { useAgentProviders, type AgentProviders } from "./useAgentProviders";

const fixture = vi.hoisted(() => ({
  config: { memory: null },
  files: { files: [], queryChunks: vi.fn() },
}));
vi.mock("@/shared/config", () => ({ getConfig: () => fixture.config }));
vi.mock("./useAgentFiles", () => ({ useAgentFiles: () => fixture.files }));
vi.mock("@/features/plugins/hooks/usePlugins", () => ({ usePlugins: () => ({ plugins }) }));

const plugins: InstalledPlugin[] = [
  {
    id: "catalog-plugin",
    hubUrl: "https://catalog.example.com",
    installedAt: "2026-10-12T00:00:00Z",
    skills: [],
    mcpServers: [{ name: "catalog-server", type: "http", url: "https://plugin.example.com/mcp" }],
  },
];
const agent = {
  id: "saved-agent",
  name: "Saved agent",
  skills: [],
  plugins: ["catalog-plugin"],
  tools: ["internet", "managed"],
  servers: [
    { id: "custom", name: "Custom server", description: "", url: "https://custom.example.com/mcp", enabled: true },
    { id: "off", name: "Disabled server", description: "", url: "https://off.example.com/mcp", enabled: false },
  ],
};

let root: Root;
let agentProviders: AgentProviders;
let pluginProviders: PluginProviders;
function Harness({ activeAgent }: { activeAgent: Agent | null }) {
  agentProviders = useAgentProviders(activeAgent);
  pluginProviders = usePluginProviders(activeAgent);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(activeAgent: Agent | null = agent) {
  await act(async () => root.render(<Harness activeAgent={activeAgent} />));
}

it("ignores legacy custom servers while retaining configured tool selections and catalog MCP servers", async () => {
  await render();
  expect(agentProviders.providers).toEqual([]);
  expect(agentProviders.enabledTools).toEqual(["internet", "managed"]);
  const catalogClientId = pluginMcpClientId("catalog-plugin", "catalog-server");
  expect(pluginProviders.servers.map((client) => client.id)).toEqual([catalogClientId]);
  expect(pluginProviders.servers[0].ownerId).toBe(pluginProviderId("catalog-plugin"));
  expect(pluginProviders.requiredIds.has(pluginProviderId("catalog-plugin"))).toBe(true);
});

it("keeps catalog MCP servers available outside an agent", async () => {
  await render(null);
  expect(pluginProviders.servers.map((client) => client.id)).toEqual([
    pluginMcpClientId("catalog-plugin", "catalog-server"),
  ]);
});
