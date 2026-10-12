import { AppBridge } from "@mcp-ui/client";
import { Client } from "@modelcontextprotocol/client";
import type { MCPClient as NativeMCPClient } from "@tanstack/ai-mcp";
import type { ContentPart, ToolResultPart, UIResourcePart } from "@tanstack/ai";
import { mediaFromDataUrl, text } from "@/shared/lib/messages";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MCPClient } from "./mcp";
import { McpAuthorizationPending } from "./mcpAuthFetch";
import { createAppBridge, getHtmlContent, buildHostCapabilities, type McpAppData } from "./mcpAppSession";

const tool = { name: "app", inputSchema: { type: "object" as const } };
const resource = {
  uri: "ui://test",
  content: { uri: "ui://test", mimeType: "text/html;profile=mcp-app", text: "<p>Grüezi 世界</p>" },
};
const savedApp = (
  content: UIResourcePart["resource"] = { uri: resource.uri, mimeType: resource.content.mimeType },
): UIResourcePart => ({
  type: "ui-resource",
  resource: content,
  serverId: "test",
  toolCallId: "call",
  toolName: "app",
});
const savedResult = (content: ContentPart[] = []): ToolResultPart => ({
  type: "tool-result",
  toolCallId: "call",
  state: "complete",
  content,
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("preserves resource permissions and CSP when the native frame sends its HTML", async () => {
  const sent = vi.spyOn(AppBridge.prototype, "sendSandboxResourceReady").mockResolvedValue();
  const data: McpAppData = {
    tool,
    resourceMeta: { csp: { connectDomains: ["https://example.test"] }, permissions: { microphone: {} } },
    html: resource.content.text,
    result: { content: [] },
    input: {},
    handlers: {},
    capabilities: {},
    subscribe: () => () => {},
  };
  const bridge = createAppBridge(data, { getDisplayMode: () => "inline", onDisplayModeRequested: vi.fn() });
  await bridge.sendSandboxResourceReady({ html: data.html, csp: data.resourceMeta?.csp });
  expect(sent).toHaveBeenCalledWith({
    html: data.html,
    csp: data.resourceMeta?.csp,
    sandbox: "allow-scripts",
    permissions: { microphone: {} },
  });
  await bridge.close();
});

it("decodes UTF-8 resources and advertises only available host features", () => {
  const blob = btoa(String.fromCharCode(...new TextEncoder().encode(resource.content.text)));
  const content = { uri: resource.uri, blob };
  expect(getHtmlContent(content)).toBe(resource.content.text);
  expect(() => getHtmlContent({ uri: resource.uri })).toThrow("Missing MCP app HTML");
  expect(buildHostCapabilities(undefined, { tools: { listChanged: true } })).toMatchObject({
    serverTools: { listChanged: true },
  });
  expect(buildHostCapabilities()).not.toHaveProperty("message");
});

it("cancels a widget resource request without waiting for the server response", async () => {
  const readResource = vi.fn().mockReturnValue(new Promise(() => {}));
  const provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
  (provider as unknown as { client: NativeMCPClient }).client = {
    readResource,
    capabilities: {},
  } as unknown as NativeMCPClient;
  provider.toolDefinitions.set("app", tool);
  const data = await provider.restoreToolUI(savedApp(resource.content), {}, savedResult(), {});
  const handler = data.handlers.onreadresource!;
  const controller = new AbortController();
  const request = handler({ uri: "report://saved" }, { signal: controller.signal } as Parameters<typeof handler>[1]);
  expect(readResource).toHaveBeenCalledWith("report://saved");
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
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
    { ...savedApp(), meta: { mcpResult: { structuredContent: { count: 2 } } } },
    { count: 1 },
    savedResult([text("Saved")]),
    {},
  );
  expect(data).toMatchObject({
    html: resource.content.text,
    input: { count: 1 },
    result: { content: [{ type: "text", text: "Saved" }], structuredContent: { count: 2 } },
  });
  const initialResult = {
    content: [
      {
        type: "resource_link" as const,
        uri: "report://saved",
        name: "report",
        annotations: { audience: ["user" as const], priority: 1 },
        _meta: { preview: "original" },
      },
    ],
    structuredContent: { count: 3 },
    _meta: { widgetState: "saved" },
    isError: true,
  };
  const restored = await provider.restoreToolUI(
    { ...savedApp(), meta: { mcpResult: initialResult } },
    {},
    savedResult([text("Resolved report")]),
    {},
  );
  expect(restored.result).toEqual(initialResult);
  const nativeError = await provider.restoreToolUI(
    savedApp(),
    {},
    {
      ...savedResult([text("Failed"), mediaFromDataUrl("data:audio/mpeg;base64,AQ==")]),
      state: "error",
      error: "Failed",
    },
    {},
  );
  expect(nativeError.result).toEqual({
    content: [
      { type: "text", text: "Failed" },
      { type: "audio", mimeType: "audio/mpeg", data: "AQ==" },
    ],
    isError: true,
  });
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
  await expect(provider.restoreToolUI(savedApp(), {}, savedResult(), {})).rejects.toThrow("Invalid UI resource");
  const controller = new AbortController();
  readResource.mockReturnValue(new Promise(() => {}));
  const pending = provider.restoreToolUI(savedApp(), {}, savedResult(), { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

it("reopens native saved HTML without reading the server resource and retains resource policy", async () => {
  const readResource = vi.fn();
  const provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
  (provider as unknown as { client: NativeMCPClient }).client = {
    readResource,
    capabilities: { tools: {} },
  } as unknown as NativeMCPClient;
  provider.toolDefinitions.set("app", tool);
  const blob = btoa(String.fromCharCode(...new TextEncoder().encode(resource.content.text)));
  const app = savedApp({ uri: resource.uri, mimeType: resource.content.mimeType, blob });
  app.meta = { ui: { csp: { connectDomains: ["https://example.test"] }, permissions: { microphone: {} } } };
  const restored = await provider.restoreToolUI(app, {}, savedResult([text("Saved")]), {});
  expect(restored.html).toBe(resource.content.text);
  expect(restored.resourceMeta).toEqual(app.meta.ui);
  expect(restored.capabilities.sandbox).toEqual(app.meta.ui);
  expect(readResource).not.toHaveBeenCalled();
  await expect(provider.restoreToolUI({ ...app, serverId: "other" }, {}, savedResult(), {})).rejects.toThrow(
    "different server",
  );
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

  it("does not resume a cancelled connection when a deferred login completes", async () => {
    let release!: () => void;
    const authorization = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connect = vi
      .spyOn(Client.prototype, "connect")
      .mockRejectedValueOnce(new McpAuthorizationPending(authorization));
    const provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
    const connecting = provider.connect();
    const rejection = expect(connecting).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    await provider.disconnect();
    release();
    await rejection;
    expect(connect).toHaveBeenCalledOnce();
    expect(provider.isConnected()).toBe(false);
  });
});
