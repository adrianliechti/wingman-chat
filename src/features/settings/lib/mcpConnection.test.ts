import { Client, type Transport } from "@modelcontextprotocol/client";
import type { CallToolResult, ListToolsResult, ServerCapabilities, Tool } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer, Server } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ElicitationResult } from "@/shared/types/elicitation";
import { MCPClient } from "./mcp";
import { mcpToolName } from "./mcpToolNames";

const transportFactory = vi.hoisted(() => ({ create: undefined as (() => Transport) | undefined }));
vi.mock("@modelcontextprotocol/client", async (original) => ({
  ...(await original<typeof import("@modelcontextprotocol/client")>()),
  StreamableHTTPClientTransport: class {
    constructor() {
      return transportFactory.create!();
    }
  },
}));

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
  transportFactory.create = () => {
    server = new Server({ name: "fixture", version: "1" }, { capabilities, supportedProtocolVersions: ["2025-11-25"] });
    servers.push(server);
    if (capabilities.tools) {
      server.setRequestHandler("tools/list", (request) => list(request.params?.cursor));
      server.setRequestHandler("tools/call", (request) => call(request.params.name));
    }
    if (capabilities.resources) server.setRequestHandler("resources/read", (request) => read(request.params));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    void server.connect(serverTransport);
    return clientTransport;
  };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
});
afterEach(async () => {
  await provider.disconnect();
  await Promise.all(servers.splice(0).map((value) => value.close()));
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MCP discovery and call ownership with the real SDK", () => {
  it("preserves unwrapped app output from a legacy server's named Zod object schema", async () => {
    const fixture = new McpServer(
      { name: "fixture", version: "1" },
      { capabilities: { resources: {} }, supportedProtocolVersions: ["2025-11-25"] },
    );
    fixture.registerTool(
      "app",
      {
        inputSchema: z.object({}),
        outputSchema: z.object({ count: z.int() }).meta({ id: "app_output_schema" }),
        _meta: { ui: { resourceUri: "ui://app" } },
      },
      async () => ({ ...result, structuredContent: { count: 2 } }),
    );
    fixture.server.setRequestHandler("resources/read", () => ({
      contents: [{ uri: "ui://app", mimeType: "text/html;profile=mcp-app", text: "<p>Widget</p>" }],
    }));
    transportFactory.create = () => {
      servers.push(fixture.server);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      void fixture.connect(serverTransport);
      return clientTransport;
    };
    await provider.connect();
    expect(provider.toolDefinitions.get("app")?.outputSchema?.type).toBe("object");
    const emitCustomEvent = vi.fn();
    expect(await provider.tools[0].execute({}, { context: {}, emitCustomEvent })).toEqual([
      { type: "text", content: "done" },
    ]);
    expect(emitCustomEvent).toHaveBeenCalledWith(
      "ui-resource",
      expect.objectContaining({
        meta: expect.objectContaining({ mcpResult: { ...result, structuredContent: { count: 2 } } }),
      }),
    );
  });

  it("preserves task-required calls and reads their completed payload", async () => {
    capabilities = { tools: {}, tasks: { requests: { tools: { call: {} } } } };
    list.mockResolvedValue({ tools: [{ ...tool("run"), execution: { taskSupport: "required" } }] });
    await provider.connect();
    const task = {
      taskId: "research-task",
      status: "working",
      pollInterval: 0,
      ttl: 60_000,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
    server.setRequestHandler("tools/call", async (request) => {
      expect(request.params.task).toEqual({});
      return { ...result, task };
    });
    const methods: string[] = [];
    server.fallbackRequestHandler = async (request) => {
      methods.push(request.method);
      if (request.method === "tasks/get") return { ...task, status: "completed" };
      if (request.method === "tasks/result") return result;
      throw new Error(`Unexpected method: ${request.method}`);
    };
    expect(await provider.tools[0].execute({}, { context: undefined, emitCustomEvent() {} })).toEqual([
      { type: "text", content: "done" },
    ]);
    expect(methods).toEqual(["tasks/get", "tasks/result"]);
  });

  it("requests unique progress tokens and routes concurrent updates only to their calls", async () => {
    await provider.connect();
    const pending = [deferred<CallToolResult>(), deferred<CallToolResult>()];
    const tokens: (string | number)[] = [];
    server.setRequestHandler("tools/call", async (request) => {
      const index = Number(request.params.arguments?.index);
      tokens[index] = request.params._meta!.progressToken!;
      await server.notification({
        method: "notifications/progress",
        params: { progressToken: tokens[index], progress: 1, message: `Searching ${index}` },
      });
      return pending[index].promise;
    });
    const updates = [vi.fn(), vi.fn()];
    const executions = updates.map((setMeta, index) =>
      provider.tools[0].execute({ index }, { context: { setMeta }, emitCustomEvent() {} }),
    );
    await expect.poll(() => updates.map((value) => value.mock.calls.length)).toEqual([1, 1]);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(updates[0]).toHaveBeenLastCalledWith({ mcpProgress: { progress: 1, message: "Searching 0" } });
    await server.notification({
      method: "notifications/progress",
      params: { progressToken: tokens[1], progress: 2, total: 4, message: "Reading sources" },
    });
    await expect.poll(() => updates[1].mock.calls.length).toBe(2);
    expect(updates[1]).toHaveBeenLastCalledWith({ mcpProgress: { progress: 2, total: 4, message: "Reading sources" } });
    expect(updates[0]).toHaveBeenCalledOnce();
    pending[0].resolve(result);
    await executions[0];
    await server.notification({
      method: "notifications/progress",
      params: { progressToken: tokens[0], progress: 3, message: "Too late" },
    });
    expect(updates[0]).toHaveBeenCalledOnce();
    pending[1].resolve(result);
    await executions[1];
  });

  it("allows research beyond the SDK's default minute and cancels without accepting later progress", async () => {
    await provider.connect();
    vi.useFakeTimers();
    const pending = deferred<CallToolResult>();
    let token!: string | number;
    server.setRequestHandler("tools/call", async (request) => {
      token = request.params._meta!.progressToken!;
      return pending.promise;
    });
    const controller = new AbortController();
    const setMeta = vi.fn();
    const execution = provider.tools[0].execute(
      {},
      { context: { signal: controller.signal, setMeta }, emitCustomEvent() {} },
    );
    const settled = vi.fn();
    void Promise.resolve(execution).then(settled, settled);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(settled).not.toHaveBeenCalled();
    await server.notification({
      method: "notifications/progress",
      params: { progressToken: token, progress: 1, message: "Still researching" },
    });
    expect(setMeta).toHaveBeenCalledOnce();
    controller.abort();
    await expect(execution).rejects.toThrow();
    await server.notification({
      method: "notifications/progress",
      params: { progressToken: token, progress: 2, message: "Too late" },
    });
    expect(setMeta).toHaveBeenCalledOnce();
    pending.resolve(result);
  });

  it("discovers every page, filters app-only tools and emits native UI resources with their HTML", async () => {
    list.mockImplementation(async (cursor) =>
      cursor === undefined
        ? {
            tools: [
              tool("app", {
                resourceUri: "ui://app",
                defaultDisplayMode: "fullscreen",
                availableDisplayModes: ["fullscreen"],
              }),
            ],
            nextCursor: "page-2",
          }
        : { tools: [tool("hidden", { visibility: ["app"] }), tool("plain")] },
    );
    call.mockResolvedValue({ ...result, structuredContent: { count: 2 } });
    const resource = {
      uri: "ui://app",
      mimeType: "text/html;profile=mcp-app",
      text: "<p>Widget</p>",
      _meta: { ui: { csp: { connectDomains: ["https://example.test"] }, permissions: { microphone: {} } } },
    };
    read.mockResolvedValue({ contents: [resource] });
    await provider.connect();
    expect(list.mock.calls.slice(0, 2)).toEqual([[undefined], ["page-2"]]);
    expect(provider.tools.map((value) => value.name)).toEqual([
      mcpToolName("test", "app"),
      mcpToolName("test", "plain"),
    ]);
    expect(provider.tools.some((value) => value.lazy)).toBe(false);
    const setMeta = vi.fn();
    const emitCustomEvent = vi.fn();
    await provider.tools[0].execute({}, { context: { setMeta }, toolCallId: "call", emitCustomEvent });
    expect(setMeta).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
    expect(emitCustomEvent).toHaveBeenCalledWith("ui-resource", {
      resource: { uri: resource.uri, mimeType: resource.mimeType, text: resource.text },
      toolCallId: "call",
      serverId: "test",
      toolName: "app",
      meta: {
        ...resource._meta,
        mcpResult: { ...result, structuredContent: { count: 2 } },
        appDisplayMode: "fullscreen",
      },
    });
  });

  it("keeps tool output when the UI resource cannot be read", async () => {
    list.mockResolvedValue({ tools: [tool("app", { resourceUri: "ui://app" })] });
    read.mockRejectedValue(new Error("Resource expired"));
    await provider.connect();
    const emitCustomEvent = vi.fn();
    expect(await provider.tools[0].execute({}, { context: undefined, emitCustomEvent })).toEqual([
      { type: "text", content: "done" },
    ]);
    expect(emitCustomEvent).not.toHaveBeenCalled();
  });

  it("connects a resource-only server without asking it for tools", async () => {
    capabilities = { resources: {} };
    await provider.connect();
    expect(list).not.toHaveBeenCalled();
    expect(provider.tools).toEqual([]);
    expect(provider.isConnected()).toBe(true);
  });

  it("marks returned tool errors while preserving the full widget result", async () => {
    list.mockResolvedValue({ tools: [tool("app", { resourceUri: "ui://app" })] });
    const failed = { ...result, isError: true, _meta: { detail: "widget-only" } };
    call.mockResolvedValue(failed);
    await provider.connect();
    const setError = vi.fn();
    const setMeta = vi.fn();
    read.mockResolvedValue({
      contents: [{ uri: "ui://app", mimeType: "text/html;profile=mcp-app", text: "<p>Error</p>" }],
    });
    const emitCustomEvent = vi.fn();
    expect(await provider.tools[0].execute({}, { context: { setError, setMeta }, emitCustomEvent })).toEqual([
      { type: "text", content: "done" },
    ]);
    expect(setError).toHaveBeenCalledWith({ code: "MCP_TOOL_ERROR", message: "done" });
    expect(setMeta).not.toHaveBeenCalled();
    expect(emitCustomEvent).toHaveBeenCalledWith(
      "ui-resource",
      expect.objectContaining({ meta: expect.objectContaining({ mcpResult: failed }) }),
    );
  });

  it("coalesces notifications during initial discovery and never publishes the invalidated scan", async () => {
    const old = deferred<ListToolsResult>();
    const latest = deferred<ListToolsResult>();
    list.mockReturnValueOnce(old.promise).mockReturnValue(latest.promise);
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
    expect(list.mock.calls.slice(0, 2)).toEqual([[undefined], [undefined]]);
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
    await expect(provider.connect()).rejects.toThrow(/pages|pagination/i);
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
    await expect(previous.execute({})).rejects.toThrow("connection changed");
    expect(call).not.toHaveBeenCalled();
    await provider.tools[0].execute({});
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
    const first = provider.tools[0].execute(
      {},
      { context: { elicit: firstElicit, onElicitationComplete: complete }, emitCustomEvent() {} },
    );
    const elicitation = server.elicitInput({
      mode: "url",
      message: "Sign in",
      url: "https://example.test/auth",
      elicitationId: "first",
    });
    await vi.waitFor(() => expect(firstElicit).toHaveBeenCalledOnce());
    const second = provider.tools[0].execute({}, { context: { elicit: secondElicit }, emitCustomEvent() {} });
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
    const running = provider.tools[0].execute({}, { context: { signal: controller.signal }, emitCustomEvent() {} });
    const rejected = expect(running).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    pending.resolve({ contents: [{ uri: "files://result", text: "too late" }] });
  });
});
