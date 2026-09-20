import { Client } from "@modelcontextprotocol/client";
import type { CallToolResult, ListToolsResult, ServerCapabilities, Tool } from "@modelcontextprotocol/client";
import { InMemoryTransport, Server } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElicitationResult } from "@/shared/types/elicitation";
import { MCPClient } from "./mcp";
import { mcpToolName } from "./mcpToolNames";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tool = (name: string, ui?: Record<string, unknown>): Tool => ({
  name,
  inputSchema: { type: "object" },
  ...(ui ? { _meta: { ui } } : {}),
});
const result: CallToolResult = { content: [{ type: "text", text: "done" }] };
const list = vi.fn<(cursor?: string) => Promise<ListToolsResult>>();
const call = vi.fn<(name: string) => Promise<CallToolResult>>();
const read = vi.fn<(...args: Parameters<Client["readResource"]>) => ReturnType<Client["readResource"]>>();
let capabilities: ServerCapabilities;
let provider: MCPClient;
let server: Server;
const servers: Server[] = [];

beforeEach(() => {
  capabilities = { tools: { listChanged: true }, resources: {} };
  list.mockReset().mockResolvedValue({ tools: [tool("run")] });
  call.mockReset().mockResolvedValue(result);
  read.mockReset().mockResolvedValue({ contents: [] });
  // Exercise the actual SDK handshake, request routing, cancellation and schemas;
  // only replace HTTP with the SDK's in-memory transport.
  const original = Reflect.get(Client.prototype, "connect") as Client["connect"];
  vi.spyOn(Client.prototype, "connect").mockImplementation(async function (this: Client, _transport, options) {
    server = new Server({ name: "fixture", version: "1" }, { capabilities });
    servers.push(server);
    if (capabilities.tools) {
      server.setRequestHandler("tools/list", (request) => list(request.params?.cursor));
      server.setRequestHandler("tools/call", (request) => call(request.params.name));
    }
    if (capabilities.resources) server.setRequestHandler("resources/read", (request) => read(request.params));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    return original.call(this, clientTransport, options);
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
});
afterEach(async () => {
  await provider.disconnect();
  await Promise.all(servers.splice(0).map((value) => value.close()));
  vi.restoreAllMocks();
});

describe("MCP discovery and call ownership with the real SDK", () => {
  it("discovers every page, filters app-only tools and persists UI metadata without fetching HTML", async () => {
    list.mockImplementation(async (cursor) =>
      cursor === undefined
        ? { tools: [tool("app", { resourceUri: "ui://app" })], nextCursor: "page-2" }
        : { tools: [tool("hidden", { visibility: ["app"] }), tool("plain")] },
    );
    call.mockResolvedValue({ ...result, structuredContent: { count: 2 } });
    await provider.connect();
    expect(list.mock.calls).toEqual([[undefined], ["page-2"]]);
    expect(provider.tools.map((value) => value.name)).toEqual([
      mcpToolName("test", "app"),
      mcpToolName("test", "plain"),
    ]);
    const setMeta = vi.fn();
    const setContent = vi.fn();
    await provider.tools[0].function({}, { setMeta, setContent });
    expect(setMeta).toHaveBeenCalledWith({ toolProvider: "test", toolResource: "ui://app" });
    expect(setContent).toHaveBeenCalledWith({ count: 2 });
    expect(read).not.toHaveBeenCalled();
  });

  it("connects a resource-only server without asking it for tools", async () => {
    capabilities = { resources: {} };
    await provider.connect();
    expect(list).not.toHaveBeenCalled();
    expect(provider.tools).toEqual([]);
    expect(provider.isConnected()).toBe(true);
  });

  it("coalesces notifications during initial discovery and never publishes the invalidated scan", async () => {
    const old = deferred<ListToolsResult>();
    const latest = deferred<ListToolsResult>();
    list.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const changed = vi.fn();
    provider.onToolsChanged = changed;
    let connected = false;
    const connecting = provider.connect().then(() => {
      connected = true;
    });
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
    await server.sendToolListChanged();
    await server.sendToolListChanged();
    old.resolve({ tools: [tool("obsolete")] });
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list.mock.calls).toEqual([[undefined], [undefined]]);
    expect(provider.tools).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    expect(connected).toBe(false);
    latest.resolve({ tools: [tool("latest")] });
    await connecting;
    expect(provider.tools[0].name).toBe(mcpToolName("test", "latest"));
    expect(changed).toHaveBeenCalledOnce();
  });

  it("fails and closes incomplete discovery, then retries with a clean connection", async () => {
    list
      .mockResolvedValueOnce({ tools: [tool("partial")], nextCursor: "next" })
      .mockRejectedValueOnce(new Error("second page failed"));
    await expect(provider.connect()).rejects.toThrow("second page failed");
    expect(provider.isConnected()).toBe(false);
    expect(provider.tools).toEqual([]);
    await provider.connect();
    expect(provider.tools[0].name).toBe(mcpToolName("test", "run"));
    expect(servers).toHaveLength(2);
  });

  it("rejects runaway pagination instead of looping or publishing partial tools", async () => {
    // The SDK stops on a repeated cursor; ever-changing cursors hit its listMaxPages cap.
    let page = 0;
    list.mockImplementation(async () => ({ tools: [tool(`partial-${page}`)], nextCursor: `page-${++page}` }));
    await expect(provider.connect()).rejects.toThrow("exceeded listMaxPages");
    expect(list.mock.calls.length).toBeGreaterThan(1);
    expect(provider.tools).toEqual([]);
    expect(provider.isConnected()).toBe(false);
  });

  it("does not let discovery from a disconnected client overwrite its replacement", async () => {
    const old = deferred<ListToolsResult>();
    list.mockReturnValueOnce(old.promise);
    const connecting = provider.connect();
    const rejected = expect(connecting).rejects.toThrow();
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
    await provider.disconnect();
    await provider.connect();
    old.resolve({ tools: [tool("stale")] });
    await rejected;
    expect(provider.tools[0].name).toBe(mcpToolName("test", "run"));
    expect(provider.isConnected()).toBe(true);
  });

  it("rejects tool functions captured before a reconnect", async () => {
    await provider.connect();
    const previous = provider.tools[0];
    await provider.disconnect();
    await provider.connect();
    await expect(previous.function({})).rejects.toThrow("connection changed");
    expect(call).not.toHaveBeenCalled();
    await provider.tools[0].function({});
    expect(call).toHaveBeenCalledOnce();
  });

  it("preserves a pending elicitation's owner when another tool starts and rejects ambiguous new requests", async () => {
    await provider.connect();
    const firstResult = deferred<CallToolResult>();
    const secondResult = deferred<CallToolResult>();
    call.mockReturnValueOnce(firstResult.promise).mockReturnValueOnce(secondResult.promise);
    const response = deferred<ElicitationResult>();
    const firstElicit = vi.fn(() => response.promise);
    const secondElicit = vi.fn(async (): Promise<ElicitationResult> => ({ action: "cancel" }));
    const complete = vi.fn(() => response.resolve({ action: "accept" }));
    const first = provider.tools[0].function({}, { elicit: firstElicit, onElicitationComplete: complete });
    const elicitation = server.elicitInput({
      mode: "url",
      message: "Sign in",
      url: "https://example.test/auth",
      elicitationId: "first",
    });
    await vi.waitFor(() => expect(firstElicit).toHaveBeenCalledOnce());
    const second = provider.tools[0].function({}, { elicit: secondElicit });
    await expect(
      server.elicitInput({ message: "Ambiguous", requestedSchema: { type: "object", properties: {} } }),
    ).rejects.toThrow("single active tool context");
    expect(secondElicit).not.toHaveBeenCalled();
    await server.notification({ method: "notifications/elicitation/complete", params: { elicitationId: "first" } });
    expect(await elicitation).toEqual({ action: "accept" });
    expect(complete).toHaveBeenCalledWith("first");
    firstResult.resolve(result);
    await first;
    await server.elicitInput({ message: "Second only", requestedSchema: { type: "object", properties: {} } });
    expect(secondElicit).toHaveBeenCalledOnce();
    secondResult.resolve(result);
    await second;
    await expect(
      server.elicitInput({ message: "No owner", requestedSchema: { type: "object", properties: {} } }),
    ).rejects.toThrow("single active tool context");
  });

  it("cancels resource-link hydration along with its tool run", async () => {
    await provider.connect();
    call.mockResolvedValue({ content: [{ type: "resource_link", name: "file", uri: "files://result" }] });
    const pending = deferred<Awaited<ReturnType<Client["readResource"]>>>();
    read.mockReturnValue(pending.promise);
    const controller = new AbortController();
    const running = provider.tools[0].function({}, { signal: controller.signal });
    const rejected = expect(running).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    pending.resolve({ contents: [{ uri: "files://result", text: "too late" }] });
  });
});
