import { AppBridge } from "@mcp-ui/client";
import { Client, UnauthorizedError } from "@modelcontextprotocol/client";
import type { MCPClient as NativeMCPClient } from "@tanstack/ai-mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MCPClient } from "./mcp";
import { createAppBridge, getHtmlContent, buildHostCapabilities, type McpAppData } from "./mcpAppSession";

const tool = { name: "app", inputSchema: { type: "object" as const } };
const resource = {
  uri: "ui://test",
  content: { uri: "ui://test", mimeType: "text/html;profile=mcp-app", text: "<p>Grüezi 世界</p>" },
};
afterEach(() => {
  vi.restoreAllMocks();
});

it("preserves resource permissions and CSP when the native frame sends its HTML", async () => {
  const sent = vi.spyOn(AppBridge.prototype, "sendSandboxResourceReady").mockResolvedValue();
  const data: McpAppData = {
    tool,
    resource: {
      ...resource,
      meta: { csp: { connectDomains: ["https://example.test"] }, permissions: { microphone: {} } },
    },
    html: resource.content.text,
    result: { content: [] },
    input: {},
    handlers: {},
    capabilities: {},
    subscribe: () => () => {},
  };
  const bridge = createAppBridge(data, { getDisplayMode: () => "inline", onDisplayModeRequested: vi.fn() });
  await bridge.sendSandboxResourceReady({ html: data.html, csp: data.resource.meta?.csp });
  expect(sent).toHaveBeenCalledWith({
    html: data.html,
    csp: data.resource.meta?.csp,
    sandbox: "allow-scripts",
    permissions: { microphone: {} },
  });
  await bridge.close();
});

it("decodes UTF-8 resources and advertises only available host features", () => {
  const blob = btoa(String.fromCharCode(...new TextEncoder().encode(resource.content.text)));
  const content = { uri: resource.uri, blob };
  expect(getHtmlContent(content)).toBe(resource.content.text);
  expect(buildHostCapabilities(undefined, { tools: { listChanged: true } })).toMatchObject({
    serverTools: { listChanged: true },
  });
  expect(buildHostCapabilities()).not.toHaveProperty("message");
});

it("restores initial inputs and structured results without executing the tool again", async () => {
  const client = {
    capabilities: {},
    readResource: vi.fn(async () => ({ contents: [resource.content] })),
    close: vi.fn(),
  } as unknown as NativeMCPClient;
  const provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
  (provider as unknown as { client: NativeMCPClient }).client = client;
  provider.toolDefinitions.set("app", tool);
  const data = await provider.restoreToolUI(
    "app",
    resource.uri,
    { count: 1 },
    [{ type: "text", text: "Saved" }],
    { count: 2 },
    {},
  );
  expect(data).toMatchObject({
    html: resource.content.text,
    input: { count: 1 },
    result: { content: [{ type: "text", text: "Saved" }], structuredContent: { count: 2 } },
  });
  const initialResult = {
    content: [],
    structuredContent: { count: 3 },
    _meta: { widgetState: "saved" },
    isError: true,
  };
  const restored = await provider.restoreToolUI("app", resource.uri, {}, [], undefined, { initialResult });
  expect(restored.result).toEqual(initialResult);
  const first = vi.fn(),
    second = vi.fn();
  const unsubscribe = data.subscribe(first);
  data.subscribe(second);
  unsubscribe();
  await provider.disconnect();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith("disconnect");
});

it("rejects unrelated resources and does not publish a late resource after cancellation", async () => {
  const readResource = vi.fn().mockResolvedValue({ contents: [{ ...resource.content, uri: "ui://other" }] });
  const provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
  (provider as unknown as { client: NativeMCPClient }).client = {
    readResource,
    capabilities: {},
  } as unknown as NativeMCPClient;
  provider.toolDefinitions.set("app", tool);
  await expect(provider.restoreToolUI("app", resource.uri, {}, [], undefined, {})).rejects.toThrow(
    "Invalid UI resource",
  );
  const controller = new AbortController();
  readResource.mockReturnValue(new Promise(() => {}));
  const pending = provider.restoreToolUI("app", resource.uri, {}, [], undefined, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

describe("MCP browser authentication lifecycle", () => {
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
