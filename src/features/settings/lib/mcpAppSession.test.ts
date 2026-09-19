import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client, UnauthorizedError } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCPClient } from "./mcp";
import { McpAppSession } from "./mcpAppSession";

const bridgeOf = (session: McpAppSession) => (session as unknown as { bridge: AppBridge }).bridge;
const iframe = () =>
  ({ clientWidth: 500, contentWindow: { postMessage: vi.fn() }, isConnected: true }) as unknown as HTMLIFrameElement;
const tool = { name: "app", inputSchema: { type: "object" as const } };
const resource = {
  uri: "ui://test",
  content: { uri: "ui://test", mimeType: "text/html;profile=mcp-app", text: "<p>App</p>" },
};
const sessions: McpAppSession[] = [];
const sentInput = vi.fn<AppBridge["sendToolInput"]>(async () => {});
const sentSandbox = vi.fn<AppBridge["sendSandboxResourceReady"]>(async () => {});
const sentToolsChanged = vi.fn<AppBridge["sendToolListChanged"]>(async () => {});
const hostContext = vi.fn<AppBridge["setHostContext"]>();
function session(signal?: AbortSignal) {
  const value = new McpAppSession({
    iframe: iframe(),
    signal,
    tool,
    resource,
    input: {},
    result: { content: [] },
    capabilities: { serverTools: { listChanged: true } },
    handlers: {},
    onClose: vi.fn(),
  });
  sessions.push(value);
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    innerWidth: 1000,
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal("document", { documentElement: { classList: { contains: () => false } } });
  vi.stubGlobal("navigator", { language: "en", userAgent: "Test" });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.spyOn(AppBridge.prototype, "sendToolInput").mockImplementation(sentInput);
  vi.spyOn(AppBridge.prototype, "sendToolResult").mockResolvedValue();
  vi.spyOn(AppBridge.prototype, "sendSandboxResourceReady").mockImplementation(sentSandbox);
  vi.spyOn(AppBridge.prototype, "sendToolListChanged").mockImplementation(sentToolsChanged);
  vi.spyOn(AppBridge.prototype, "setHostContext").mockImplementation(hostContext);
  vi.spyOn(AppBridge.prototype, "teardownResource").mockResolvedValue({});
});
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((value) => value.close()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("MCP app sessions", () => {
  it("waits for initialization, sends a sandbox resource once, and closes only its own transport", async () => {
    const first = session();
    const second = session();
    const firstBridge = bridgeOf(first);
    const secondBridge = bridgeOf(second);
    const firstClose = vi.spyOn(firstBridge, "close");
    const secondClose = vi.spyOn(secondBridge, "close");
    let ready = false;
    const firstReady = first.connect().then(() => {
      ready = true;
    });
    const secondReady = second.connect();
    await Promise.resolve();
    expect(ready).toBe(false);
    firstBridge.onsandboxready?.({});
    firstBridge.onsandboxready?.({});
    expect(sentSandbox).toHaveBeenCalledOnce();
    firstBridge.oninitialized?.({});
    secondBridge.oninitialized?.({});
    await Promise.all([firstReady, secondReady]);
    first.setDisplayMode("fullscreen");
    expect(hostContext.mock.instances.at(-1)).toBe(firstBridge);
    await first.close();
    expect(firstClose).toHaveBeenCalledOnce();
    expect(secondClose).not.toHaveBeenCalled();
    await second.notify("tools");
    expect(sentToolsChanged.mock.instances.at(-1)).toBe(secondBridge);
  });

  it("coalesces repeated connect calls and never reopens a closed session", async () => {
    const value = session();
    const bridge = bridgeOf(value);
    const connect = vi.spyOn(bridge, "connect");
    const pending = value.connect();
    expect(value.connect()).toBe(pending);
    bridge.oninitialized?.({});
    await pending;
    await value.connect();
    expect(connect).toHaveBeenCalledOnce();
    await value.close();
    await expect(value.connect()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects an unrelated HTML resource instead of displaying it", async () => {
    const sdk = new Client({ name: "Test", version: "1" });
    const provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
    (provider as unknown as { client: Client }).client = sdk;
    provider.toolDefinitions.set("app", tool);
    vi.spyOn(sdk, "readResource").mockResolvedValue({ contents: [{ ...resource.content, uri: "ui://unrelated" }] });
    await expect(provider.restoreToolUI("app", resource.uri, {}, [], undefined, { iframe: iframe() })).rejects.toThrow(
      "Invalid UI resource",
    );
    expect(sentSandbox).not.toHaveBeenCalled();
    await provider.disconnect();
  });

  it("aborts a late initialization without sending tool data or leaking a bridge", async () => {
    const controller = new AbortController();
    const value = session(controller.signal);
    const bridge = bridgeOf(value);
    const close = vi.spyOn(bridge, "close");
    const pending = value.connect();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    bridge.oninitialized?.({});
    expect(sentInput).not.toHaveBeenCalled();
    await value.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("times out an app that never initializes and releases its transport", async () => {
    vi.useFakeTimers();
    const value = session();
    const close = vi.spyOn(bridgeOf(value), "close");
    const result = value.connect().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toMatchObject({ message: "MCP app did not initialize in time" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves SDK discovery listeners while fanning out notifications to two apps on one server", async () => {
    const sdk = new Client({ name: "Test", version: "1" });
    vi.spyOn(sdk, "getServerCapabilities").mockReturnValue({ tools: { listChanged: true } });
    const refresh = vi.fn();
    sdk.setNotificationHandler("notifications/tools/list_changed", refresh);
    const handlers = (sdk as unknown as { _notificationHandlers: Map<string, unknown> })._notificationHandlers;
    const handler = handlers.get("notifications/tools/list_changed");
    const provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
    const internals = provider as unknown as {
      client: Client;
      appSessions: Set<McpAppSession>;
      notifyApps(kind: "tools"): Promise<void>;
    };
    internals.client = sdk;
    provider.toolDefinitions.set("app", tool);
    vi.spyOn(sdk, "readResource").mockResolvedValue({ contents: [resource.content] });
    const first = provider.restoreToolUI("app", resource.uri, {}, [], undefined, { iframe: iframe() });
    const second = provider.restoreToolUI("app", resource.uri, {}, [], undefined, { iframe: iframe() });
    await vi.waitFor(() => expect(internals.appSessions.size).toBe(2));
    for (const app of internals.appSessions) bridgeOf(app).oninitialized?.({});
    const active = await Promise.all([first, second]);
    sessions.push(...active);
    expect(handlers.get("notifications/tools/list_changed")).toBe(handler);
    await internals.notifyApps("tools");
    expect(sentToolsChanged).toHaveBeenCalledTimes(2);
    await active[0].close();
    expect(internals.appSessions.size).toBe(1);
    await internals.notifyApps("tools");
    expect(sentToolsChanged).toHaveBeenCalledTimes(3);
    await provider.disconnect();
    expect(internals.appSessions.size).toBe(0);
  });

  it("coalesces concurrent connections and rejects a connection disabled during initialization", async () => {
    let release!: () => void;
    const connect = vi.spyOn(Client.prototype, "connect").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
    const connecting = provider.connect();
    const rejection = expect(connecting).rejects.toMatchObject({ name: "AbortError" });
    expect(provider.connect()).toBe(connecting);
    await provider.disconnect();
    release();
    await rejection;
    expect(provider.isConnected()).toBe(false);
    expect(provider.tools).toEqual([]);
    expect(connect).toHaveBeenCalledOnce();
  });

  it("does not publish stale authentication state after the connection is disabled", async () => {
    vi.spyOn(Client.prototype, "connect").mockRejectedValueOnce(new UnauthorizedError());
    let release!: (code: string) => void;
    const provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
    const auth = (provider as unknown as { authProvider: { waitForAuthCode(): Promise<string> } }).authProvider;
    vi.spyOn(auth, "waitForAuthCode").mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const authenticating = vi.fn();
    const completed = vi.fn();
    provider.onAuthenticating = authenticating;
    provider.onAuthComplete = completed;
    const connecting = provider.connect();
    const rejection = expect(connecting).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(authenticating).toHaveBeenCalledOnce());
    await provider.disconnect();
    release("late-code");
    await rejection;
    expect(completed).not.toHaveBeenCalled();
    expect(provider.isConnected()).toBe(false);
  });
});
