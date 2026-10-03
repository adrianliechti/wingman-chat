import {
  createMcpHandler,
  inputRequired,
  inputResponse,
  Server,
  type McpHttpHandler,
  type ServerContext,
} from "@modelcontextprotocol/server";
import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCPClient } from "./mcp";

type Wire = { method?: string; id?: string | number; params?: Record<string, unknown> };
type Call = (name: string, ctx: ServerContext) => CallToolResult | ReturnType<typeof inputRequired>;

const schema = { type: "object", properties: { name: { type: "string" } } } as const;
const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] });

let tools: Tool[];
let call: ReturnType<typeof vi.fn<Call>>;
let handler: McpHttpHandler;
let wire: Wire[];
let probeStatus: number | undefined;
let provider: MCPClient;

function factory() {
  const server = new Server(
    { name: "fixture", version: "1", icons: [{ src: "https://example.test/icon.png" }] },
    { capabilities: { tools: { listChanged: true } }, instructions: "Use the fixture tools." },
  );
  server.setRequestHandler("tools/list", () => ({ tools }));
  server.setRequestHandler("tools/call", (request, ctx) => call(request.params.name, ctx));
  return server;
}

beforeEach(() => {
  tools = [
    { name: "run", inputSchema: { type: "object" } },
    { name: "ask", inputSchema: { type: "object" } },
  ];
  call = vi.fn<Call>().mockImplementation(() => text("done"));
  handler = createMcpHandler(factory);
  wire = [];
  probeStatus = undefined;
  // The real browser transport over HTTP, served by the SDK's 2026-07-28 handler.
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Wire) : undefined;
    if (body) wire.push(body);
    if (probeStatus && body?.method === "server/discover") return new Response("no handler", { status: probeStatus });
    return handler.fetch(new Request(url, init));
  });
  provider = new MCPClient("test", "https://example.test/mcp", "Test", "Test");
});
afterEach(async () => {
  await provider.disconnect();
  await handler.close();
  vi.unstubAllGlobals();
});

const methods = () => wire.map((message) => message.method).filter(Boolean);
const retries = () => wire.filter((message) => message.method === "tools/call" && message.params?.name === "ask");
const tool = (name: string) => provider.tools.find((value) => value.name.includes(`__${name}_`))!;
const askOnce = (answer: (ctx: ServerContext) => CallToolResult) => (name: string, ctx: ServerContext) => {
  if (name !== "ask") return text("done");
  if (inputResponse(ctx.mcpReq.inputResponses, "name").kind === "missing")
    return inputRequired({
      inputRequests: { name: inputRequired.elicit({ message: "Your name?", requestedSchema: schema }) },
      requestState: "state-1",
    });
  return answer(ctx);
};

describe("MCP over the 2026-07-28 protocol with the real SDK", () => {
  it("negotiates the modern revision and keeps the server identity from server/discover", async () => {
    await provider.connect();
    expect(methods()).not.toContain("initialize");
    expect(wire[0].params?._meta).toMatchObject({ "io.modelcontextprotocol/protocolVersion": "2026-07-28" });
    const meta = wire[0].params!._meta as Record<string, Record<string, unknown>>;
    const capabilities = meta["io.modelcontextprotocol/clientCapabilities"];
    expect(capabilities.elicitation).toEqual({ form: {}, url: {} });
    expect(capabilities).not.toHaveProperty("sampling");
    expect(provider.instructions).toBe("Use the fixture tools.");
    expect(provider.icon).toBe("https://example.test/icon.png");

    expect(await tool("run").execute({}, { context: {}, emitCustomEvent() {} })).toEqual([
      { type: "text", content: "done" },
    ]);
    expect(call).toHaveBeenCalledWith("run", expect.anything());
  });

  it("answers input_required elicitations and retries with the echoed request state", async () => {
    call.mockImplementation(
      askOnce((ctx) => {
        const answer = inputResponse(ctx.mcpReq.inputResponses, "name");
        return text(
          `${ctx.mcpReq.requestState<string>()}:${answer.kind === "elicit" ? String(answer.content?.name) : "none"}`,
        );
      }),
    );
    await provider.connect();
    const elicit = vi.fn().mockResolvedValue({ action: "accept", content: { name: "Ada" } });

    expect(await tool("ask").execute({}, { context: { elicit }, emitCustomEvent() {} })).toEqual([
      { type: "text", content: "state-1:Ada" },
    ]);
    expect(elicit).toHaveBeenCalledOnce();
    expect(elicit.mock.calls[0][0]).toMatchObject({ message: "Your name?", requestedSchema: schema });
    expect(retries()).toHaveLength(2);
    expect(retries()[1].params).toMatchObject({
      inputResponses: { name: { action: "accept", content: { name: "Ada" } } },
      requestState: "state-1",
    });
  });

  it("answers every round of a multi-round tool call", async () => {
    call.mockImplementation((_name, ctx) => {
      const round = Number(ctx.mcpReq.requestState<string>() ?? 0);
      if (round < 2)
        return inputRequired({
          inputRequests: { name: inputRequired.elicit({ message: `Round ${round}`, requestedSchema: schema }) },
          requestState: String(round + 1),
        });
      return text("finished");
    });
    await provider.connect();
    const elicit = vi.fn().mockResolvedValue({ action: "accept", content: { name: "Ada" } });

    expect(await tool("ask").execute({}, { context: { elicit }, emitCustomEvent() {} })).toEqual([
      { type: "text", content: "finished" },
    ]);
    expect(elicit.mock.calls.map(([params]) => params.message)).toEqual(["Round 0", "Round 1"]);
  });

  it("passes a declined elicitation to the server", async () => {
    call.mockImplementation(
      askOnce((ctx) => {
        const answer = inputResponse(ctx.mcpReq.inputResponses, "name");
        return text(answer.kind === "elicit" ? answer.action : answer.kind);
      }),
    );
    await provider.connect();

    const elicit = vi.fn().mockResolvedValue({ action: "decline" });
    expect(await tool("ask").execute({}, { context: { elicit }, emitCustomEvent() {} })).toEqual([
      { type: "text", content: "decline" },
    ]);
  });

  it("fails the tool call without retrying when no one can answer the elicitation", async () => {
    call.mockImplementation(askOnce(() => text("unreachable")));
    await provider.connect();

    await expect(tool("ask").execute({}, { context: {}, emitCustomEvent() {} })).rejects.toThrow(
      "Elicitation requires a single active tool context",
    );
    expect(retries()).toHaveLength(1);
  });

  it("does not advertise sampling, so servers cannot ask Wingman for model output", async () => {
    call.mockImplementation(() =>
      inputRequired({
        inputRequests: {
          model: inputRequired.createMessage({
            messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
            maxTokens: 10,
          }),
        },
      }),
    );
    await provider.connect();

    await expect(tool("ask").execute({}, { context: { elicit: vi.fn() }, emitCustomEvent() {} })).rejects.toThrow(
      /sampling\/createMessage.*capabilit/,
    );
  });

  it("refreshes tools when the server publishes a tool list change", async () => {
    await provider.connect();
    expect(methods()).toContain("subscriptions/listen");
    const changed = new Promise<void>((resolve) => {
      provider.onToolsChanged = resolve;
    });

    tools = [...tools, { name: "added", inputSchema: { type: "object" } }];
    handler.notify.toolsChanged();
    await changed;
    expect(tool("added")).toBeDefined();
  });

  it("falls back to 2025 initialize when a legacy server answers the probe with HTTP 500", async () => {
    probeStatus = 500;
    await provider.connect();

    expect(methods().slice(0, 2)).toEqual(["server/discover", "initialize"]);
    expect(provider.instructions).toBe("Use the fixture tools.");
    expect(await tool("run").execute({}, { context: {}, emitCustomEvent() {} })).toEqual([
      { type: "text", content: "done" },
    ]);
  });
});
