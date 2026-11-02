// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "@/features/plugins/lib/types";
import type { Agent } from "@/features/agent/types/agent";
import type { UIResourcePart, ToolResultPart } from "@tanstack/ai";
import { McpAuthRequiredError } from "@/features/settings/lib/mcpAuth";
import type { McpApproval } from "@/features/settings/lib/mcpConfig";
import { ToolsProvider } from "./ToolsProvider";
import { useToolsContext } from "../hooks/useToolsContext";

const fixture = vi.hoisted(() => ({
  plugins: [] as InstalledPlugin[],
  agent: null as Agent | null,
  config: { mcps: [], companion: null },
  agents: { providers: [], enabledTools: [] as string[] },
  connect: vi.fn<() => Promise<void>>(),
}));
vi.mock("@/features/plugins/hooks/usePlugins", () => ({
  usePlugins: () => ({ plugins: fixture.plugins, isLoaded: true }),
}));
vi.mock("@/features/agent/hooks/useAgents", () => ({ useAgents: () => ({ currentAgent: fixture.agent }) }));
vi.mock("@/features/agent/hooks/useAgentProviders", () => ({ useAgentProviders: () => fixture.agents }));
vi.mock("@/features/artifacts/hooks/useArtifactsProvider", () => ({ useArtifactsProvider: () => null }));
vi.mock("@/features/skills/hooks/useSkillBuilderProvider", () => ({ useSkillBuilderProvider: () => null }));
vi.mock("@/features/skills/hooks/useSkillsProvider", () => ({
  useSkillsProvider: () => ({ provider: null, forSelection: () => null }),
}));
vi.mock("@/shared/config", () => ({ getConfig: () => fixture.config }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: undefined }),
}));
vi.mock("@/shared/lib/queryClient", () => ({ queryClient: {} }));
vi.mock("@/features/settings/lib/mcp", () => ({
  MCPClient: class {
    tools = [];
    connected = false;
    connect = vi.fn(async () => {
      await fixture.connect();
      this.connected = true;
    });
    disconnect = vi.fn(async () => {
      this.connected = false;
    });
    armInteractiveAuth = vi.fn();
    restoreToolUI = vi.fn();
    id: string;
    url: string;
    name: string;
    description: string;
    headers?: Record<string, string>;
    approval?: McpApproval;
    constructor(
      id: string,
      url: string,
      name: string,
      description: string,
      headers?: Record<string, string>,
      _icon?: unknown,
      approval?: McpApproval,
    ) {
      this.id = id;
      this.url = url;
      this.name = name;
      this.description = description;
      this.headers = headers;
      this.approval = approval;
    }
    isConnected() {
      return this.connected;
    }
    isAuthBlocked() {
      return false;
    }
  },
}));

let root: Root;
let context: ReturnType<typeof useToolsContext>;
function Harness() {
  context = useToolsContext();
  return null;
}
const owner = "plugin:demo";
const child = `${owner}:mcp:server`;
const render = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <ToolsProvider>
          <Harness />
        </ToolsProvider>
      </StrictMode>,
    ),
  );
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
const client = () =>
  context.providers.find((provider) => provider.id === child) as unknown as {
    url: string;
    headers: Record<string, string>;
    approval?: McpApproval;
    disconnect: ReturnType<typeof vi.fn>;
    onDisconnected: (() => void) | null;
  };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  localStorage.clear();
  fixture.connect.mockReset().mockResolvedValue(undefined);
  fixture.agent = null;
  fixture.plugins = [
    {
      id: "demo",
      hubUrl: "https://catalog.test",
      installedAt: "now",
      skills: [],
      mcpServers: [{ name: "server", type: "http", url: "https://old.test/mcp" }],
    },
  ];
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("enables the owner when a child is requested and disconnects every child when disabled", async () => {
  await render();
  await settle();
  await act(async () => context.setProviderEnabled(child, true));
  expect(context.isProviderEnabled(owner)).toBe(true);
  expect(context.getProviderState(child)).toBe("connected");
  expect(JSON.parse(localStorage.getItem("app_tools")!)).toEqual([owner]);
  const original = client();
  await act(async () => context.setProviderEnabled(owner, false));
  await settle();
  expect(context.getProviderState(child)).toBe("disconnected");
  expect(original.disconnect).toHaveBeenCalledOnce();
  expect(JSON.parse(localStorage.getItem("app_tools")!)).toEqual([]);
});

it.each([undefined, "none", "individual", "delegated"] as const)(
  "applies plugin MCP approval mode %s without reconnecting for an equivalent object",
  async (mode) => {
    const approval = mode === undefined ? undefined : { mode };
    fixture.plugins[0].mcpServers![0].approval = approval;
    await render();
    await settle();
    const original = client();
    expect(original.approval).toEqual(approval);
    fixture.plugins = [
      {
        ...fixture.plugins[0],
        mcpServers: [
          { ...fixture.plugins[0].mcpServers![0], approval: mode === undefined ? { mode: "none" } : { mode } },
        ],
      },
    ];
    await render();
    await settle();
    expect(client()).toBe(original);
    expect(original.disconnect).not.toHaveBeenCalled();
    fixture.plugins = [
      {
        ...fixture.plugins[0],
        mcpServers: [
          { ...fixture.plugins[0].mcpServers![0], approval: { mode: mode === "individual" ? "delegated" : "individual" } },
        ],
      },
    ];
    await render();
    await settle();
    expect(client()).not.toBe(original);
    expect(original.disconnect).toHaveBeenCalledOnce();
  },
);

it("discards legacy child selections and refuses to enable them while restoring a saved widget", async () => {
  localStorage.setItem("app_tools", JSON.stringify([child]));
  await render();
  await settle();
  expect(context.isProviderEnabled(child)).toBe(false);
  await expect(
    context.restoreToolUI({ serverId: child } as UIResourcePart, {}, {} as ToolResultPart, {}),
  ).rejects.toThrow("Enable");
  expect(fixture.connect).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem("app_tools")!)).toEqual([]);
});

it("replaces endpoint and header changes, ignores stale callbacks, and releases removed clients once", async () => {
  localStorage.setItem("app_tools", JSON.stringify([owner]));
  await render();
  await settle();
  const original = client();
  const staleCallback = original.onDisconnected!;
  fixture.plugins = [
    {
      ...fixture.plugins[0],
      mcpServers: [{ name: "server", type: "http", url: "https://new.test/mcp", headers: { "X-Tenant": "new" } }],
    },
  ];
  await render();
  await settle();
  expect(original.disconnect).toHaveBeenCalledOnce();
  expect(client()).not.toBe(original);
  expect(client().url).toBe("https://new.test/mcp");
  expect(client().headers).toEqual({ "x-tenant": "new" });
  await act(async () => staleCallback());
  expect(context.getProviderState(child)).toBe("connected");
  const updated = client();
  fixture.plugins = [];
  await render();
  await settle();
  expect(updated.disconnect).toHaveBeenCalledOnce();
  expect(context.providers).toEqual([]);
  expect(JSON.parse(localStorage.getItem("app_tools")!)).toEqual([]);
});

it("keeps selection on auth failure, does not auto-retry, and retries only on user action", async () => {
  fixture.connect.mockRejectedValueOnce(new McpAuthRequiredError(child, "denied"));
  localStorage.setItem("app_tools", JSON.stringify([owner]));
  await render();
  await settle();
  expect(context.isProviderEnabled(owner)).toBe(true);
  expect(context.getProviderState(owner)).toBe("unauthorized");
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fixture.connect).toHaveBeenCalledOnce();
  await act(async () => context.setProviderEnabled(child, true));
  expect(context.getProviderState(owner)).toBe("connected");
});

it("cancels retry backoff on disable and preserves an agent's required plugin policy for child requests", async () => {
  fixture.connect.mockRejectedValue(new Error("offline"));
  localStorage.setItem("app_tools", JSON.stringify([owner]));
  await render();
  await settle();
  expect(context.getProviderState(owner)).toBe("initializing");
  await act(async () => context.setProviderEnabled(owner, false));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fixture.connect).toHaveBeenCalledOnce();
  fixture.connect.mockResolvedValue(undefined);
  fixture.agent = { id: "agent", plugins: ["demo"] } as Agent;
  await render();
  await settle();
  expect(context.getProviderPolicy(child)).toBe("required");
  await act(async () => context.setProviderEnabled(child, false));
  expect(context.getProviderState(child)).toBe("connected");
});

it("ignores late completion from an endpoint replaced during connection", async () => {
  let resolveOld!: () => void;
  fixture.connect.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveOld = resolve;
      }),
  );
  localStorage.setItem("app_tools", JSON.stringify([owner]));
  await render();
  await settle();
  const original = client();
  fixture.plugins = [
    { ...fixture.plugins[0], mcpServers: [{ name: "server", type: "http", url: "https://new.test/mcp" }] },
  ];
  await render();
  await settle();
  expect(context.getProviderState(child)).toBe("connected");
  await act(async () => resolveOld());
  expect(client()).not.toBe(original);
  expect(original.disconnect).toHaveBeenCalledOnce();
  expect(context.getProviderState(child)).toBe("connected");
  expect(fixture.connect).toHaveBeenCalledTimes(2);
});
