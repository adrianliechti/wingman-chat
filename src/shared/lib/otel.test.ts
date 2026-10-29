import { z } from "zod";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Client } from "./client";
import { run, runMessages } from "./agent";
import { assistant, calls, finished, output, response, textItem, testClient, user } from "./test-support/ai";
import { trace, type Span } from "@opentelemetry/api";
import { chat } from "@tanstack/ai";
import { aiTelemetry } from "./otel";
import { createSkillsProvider } from "@/features/skills/lib/skillsProvider";
import { createMcpAgentChat } from "@/features/tools/lib/mcpAgent";

vi.mock("@/shared/config", () => ({ getConfig: () => ({ client: new Client() }) }));

const telemetry = vi.hoisted(() => ({
  spans: [] as {
    name: string;
    attributes: Record<string, unknown>;
    parent?: unknown;
    end: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
  }[],
  histogram: vi.fn(),
}));
vi.mock("@opentelemetry/api", async (importOriginal) => {
  const api = await importOriginal<typeof import("@opentelemetry/api")>();
  return {
    ...api,
    trace: {
      getSpan: (ctx: Parameters<typeof api.trace.getSpan>[0]) => api.trace.getSpan(ctx),
      setSpan: (ctx: Parameters<typeof api.trace.setSpan>[0], span: Parameters<typeof api.trace.setSpan>[1]) =>
        api.trace.setSpan(ctx, span),
      getTracer: () => ({
        startActiveSpan: vi.fn(),
        startSpan: (
          name: string,
          options: { attributes?: Record<string, unknown> } = {},
          parent?: Parameters<typeof api.trace.getSpan>[0],
        ) => {
          const attributes = { ...options.attributes };
          const spanId = (telemetry.spans.length + 1).toString(16).padStart(16, "0");
          const span = {
            name,
            attributes,
            parent: parent && api.trace.getSpan(parent),
            end: vi.fn(),
            setStatus: vi.fn(),
            recordException: vi.fn(),
            addEvent: vi.fn(),
            isRecording: () => true,
            spanContext: () => ({ traceId: "1".repeat(32), spanId, traceFlags: 1 }),
            setAttribute: (key: string, value: unknown) => {
              attributes[key] = value;
            },
            setAttributes: (values: Record<string, unknown>) => Object.assign(attributes, values),
          };
          telemetry.spans.push(span);
          return span;
        },
      }),
    },
    metrics: {
      getMeter: () => ({
        createHistogram: (name: string) => ({ record: (...args: unknown[]) => telemetry.histogram(name, ...args) }),
      }),
    },
  };
});

beforeEach(() => {
  telemetry.spans.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal("window", { location: new URL("http://localhost") });
});
afterEach(() => vi.unstubAllGlobals());

it.each(["chat", "summarize_history", "classify_chat"])(
  "records native %s usage without capturing conversation content",
  async (operation) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        operation === "classify_chat"
          ? Response.json({
              answers: { risk_0: { type: "noul", noul: 0.2 } },
              usage: { input_tokens: 10, output_tokens: 5 },
            })
          : finished(response([textItem(operation === "chat" ? "Private answer" : '{"summary":"Private summary"}')])),
      ),
    );
    const client = new Client();
    if (operation === "chat") await runMessages(client, "model", "Private instructions", [user("Private input")], []);
    else if (operation === "classify_chat")
      await client.classifyChat(
        "model",
        [user("Private input")],
        [],
        [{ id: "risk", description: "Private criterion" }],
      );
    else
      await chat({
        threadId: "telemetry-chat",
        adapter: client.textAdapter("model"),
        messages: [{ role: "user", content: "Private input" }],
        stream: false,
        middleware: [aiTelemetry(operation)],
      });
    expect(telemetry.spans.length).toBeGreaterThan(0);
    for (const span of telemetry.spans) expect(span.end).toHaveBeenCalledOnce();
    expect(
      telemetry.spans.some(
        (span) =>
          span.attributes["gen_ai.usage.input_tokens"] === 10 && span.attributes["gen_ai.usage.output_tokens"] === 5,
      ),
    ).toBe(true);
    expect(telemetry.spans.some((span) => span.attributes["wingman.operation.name"] === operation)).toBe(true);
    expect(JSON.stringify(telemetry.spans.map((span) => span.attributes))).not.toContain("Private");
    if (operation === "classify_chat") {
      expect(telemetry.histogram).toHaveBeenCalledWith(
        "gen_ai.client.operation.duration",
        expect.any(Number),
        expect.objectContaining({ "gen_ai.operation.name": "evaluate" }),
      );
    } else {
      expect(telemetry.histogram).toHaveBeenCalledWith(
        "gen_ai.client.token.usage",
        5,
        expect.objectContaining({ "gen_ai.token.type": "output" }),
      );
    }
  },
);

it("closes native spans when generation fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        finished(response([], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })),
      ),
  );
  await expect(runMessages(new Client(), "model", "", [], [])).rejects.toThrow();
  expect(telemetry.spans.length).toBeGreaterThan(0);
  for (const span of telemetry.spans) expect(span.end).toHaveBeenCalledOnce();
  expect(telemetry.spans.some((span) => span.setStatus.mock.calls.some(([status]) => status.code === 2))).toBe(true);
});

it("uses one native tool span and parents delegated calls to it without an async context manager", async () => {
  const answer = assistant("Private answer");
  const complete = vi
    .fn<Parameters<typeof testClient>[0]>()
    .mockResolvedValueOnce(calls(["delegate-1", "delegate"]))
    .mockResolvedValue(answer);
  let toolSpan: Span | undefined;
  await runMessages(
    testClient(complete),
    "model",
    "",
    [],
    [
      {
        name: "delegate",
        description: "Test tool",
        inputSchema: z.looseObject({}),
        execute: async (_args, execution) => {
          const context = execution?.context;
          toolSpan = context?.agentContext && trace.getSpan(context.agentContext);
          await Promise.resolve();
          await runMessages(testClient(complete), "child", "", [], [], {
            agentName: "child",
            parentContext: context?.agentContext,
            context: context?.invocationContext,
          });
          return output("Private tool result");
        },
      },
    ],
  );
  const toolSpans = telemetry.spans.filter((span) => span.attributes["gen_ai.tool.call.id"] === "delegate-1");
  expect(toolSpans).toHaveLength(1);
  expect(toolSpan).toBe(toolSpans[0]);
  expect(telemetry.spans.find((span) => span.attributes["wingman.operation.name"] === "child")?.parent).toBe(toolSpan);
  expect(telemetry.spans.some((span) => span.name.startsWith("invoke_agent"))).toBe(false);
  for (const span of telemetry.spans) expect(span.end).toHaveBeenCalledOnce();
  expect(JSON.stringify(telemetry.spans.map((span) => span.attributes))).not.toContain("Private");
});

it("closes failed tool spans through the native error lifecycle", async () => {
  const complete = vi
    .fn<Parameters<typeof testClient>[0]>()
    .mockResolvedValueOnce(calls(["failed-1", "fail"]))
    .mockResolvedValue(assistant("The tool failed."));
  await runMessages(
    testClient(complete),
    "model",
    "",
    [],
    [
      {
        name: "fail",
        description: "Test tool",
        inputSchema: z.looseObject({}),
        execute: async () => {
          throw new Error("Tool failed");
        },
      },
    ],
  );
  const spans = telemetry.spans.filter((span) => span.attributes["gen_ai.tool.call.id"] === "failed-1");
  expect(spans).toHaveLength(1);
  expect(spans[0].attributes["tanstack.ai.tool.outcome"]).toBe("error");
  expect(spans[0].setStatus).toHaveBeenCalledWith(expect.objectContaining({ code: 2 }));
  for (const span of telemetry.spans) expect(span.end).toHaveBeenCalledOnce();
});

it("identifies configured agents once per run and correlates their tools without recording content", async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["tool-1", "search"]))
    .mockResolvedValue(assistant("Private answer"));
  await runMessages(
    testClient(complete),
    "model",
    "Private instructions",
    [user("Private prompt")],
    [
      {
        name: "search",
        description: "Private tool description",
        inputSchema: z.looseObject({}),
        telemetry: { serverId: "documents", serverName: "Documents", pluginId: "research" },
        execute: async () => output("Private document"),
      },
    ],
    { threadId: "conversation-1", agentIdentity: { id: "agent-1", name: "Research assistant", kind: "configured" } },
  );
  const invocations = telemetry.spans.filter((span) => span.attributes["gen_ai.operation.name"] === "invoke_agent");
  expect(invocations).toHaveLength(1);
  expect(invocations[0].attributes).toMatchObject({
    "gen_ai.agent.id": "agent-1",
    "gen_ai.agent.name": "Research assistant",
  });
  expect(invocations[0].attributes["wingman.agent.outcome"]).toBe("success");
  const tool = telemetry.spans.find((span) => span.attributes["gen_ai.tool.name"] === "search");
  expect(tool?.attributes).toMatchObject({
    "wingman.mcp.server.id": "documents",
    "wingman.plugin.id": "research",
    "gen_ai.conversation.id": "conversation-1",
  });
  expect(JSON.stringify(telemetry.spans.map((span) => span.attributes))).not.toContain("Private");
});

it.each([
  { name: "load_skill", args: { name: "office:reports" } },
  { name: "read_skill_resource", args: { skill: "office:reports", path: "reference.md" } },
  { name: "read_skill_resource", args: { skill: "office:reports", path: "Private unknown resource" } },
])("records catalog-validated skill and plugin identity on $name", async ({ name, args }) => {
  const provider = createSkillsProvider(
    [
      {
        name: "reports",
        plugin: "office",
        description: "Private description",
        loadContent: () => "Private instructions",
        resources: ["reference.md"],
        loadResource: () => "Private resource",
      },
    ],
    { id: "skills", name: "Skills", description: "" },
  )!;
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["skill-1", name, args]))
    .mockResolvedValue(assistant("Done"));
  await runMessages(testClient(complete), "model", "", [], provider.chat!.tools, {
    middleware: provider.chat!.middleware,
  });
  const load = telemetry.spans.filter((span) => span.attributes["gen_ai.tool.name"] === name);
  expect(load).toHaveLength(1);
  expect(load[0].attributes).toMatchObject({
    "gen_ai.skill.name": "office:reports",
    "wingman.plugin.id": "office",
  });
  if (args.path === "reference.md") expect(load[0].attributes["gen_ai.skill.resource.name"]).toBe("reference.md");
  else expect(load[0].attributes).not.toHaveProperty("gen_ai.skill.resource.name");
  expect(load[0].attributes).not.toHaveProperty("wingman.skill.name");
  expect(load[0].attributes).not.toHaveProperty("wingman.skill.id");
  expect(JSON.stringify(telemetry.spans.map((span) => span.attributes))).not.toContain("Private");
});

it("keeps native delegated agents in the parent trace and original conversation", async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["delegation-1", "research", { prompt: "Private task" }]))
    .mockResolvedValue(assistant("Done"));
  await runMessages(
    testClient(complete),
    "model",
    "",
    [],
    [
      {
        name: "research",
        description: "Research",
        inputSchema: z.object({ prompt: z.string() }),
        telemetry: { agent: { id: "mcp:internet", name: "Web research", kind: "delegated" }, serverId: "internet" },
        subagent: { instructions: "Private instructions", tools: [] },
        execute: async () => [],
      },
    ],
    {
      threadId: "original-conversation",
      agentIdentity: { id: "parent-agent", name: "Coordinator", kind: "configured" },
    },
  );
  const delegation = telemetry.spans.find((span) => span.attributes["gen_ai.tool.call.id"] === "delegation-1");
  expect(delegation?.attributes).toMatchObject({
    "gen_ai.agent.id": "parent-agent",
    "gen_ai.agent.name": "Coordinator",
    "gen_ai.transfer.target.name": "Web research",
    "gen_ai.transfer.mode": "return_to_caller",
    "wingman.transfer.target.id": "mcp:internet",
    "wingman.transfer.target.kind": "delegated",
  });
  expect(delegation?.attributes).not.toHaveProperty("wingman.activity.kind");
  const child = telemetry.spans.find((span) => span.attributes["wingman.operation.name"] === "research");
  expect(child).toBeDefined();
  expect(child?.parent).toBe(delegation?.parent);
  expect(child?.attributes["gen_ai.conversation.id"]).toBe("original-conversation");
  expect(telemetry.spans.filter((span) => span.attributes["gen_ai.operation.name"] === "invoke_agent")).toHaveLength(1);
});

it.each(["personal", "builtin"] as const)("distinguishes %s skill loads without exporting content", async (source) => {
  const provider = createSkillsProvider(
    [{ name: "reports", source, description: "Private description", loadContent: () => "Private instructions" }],
    { id: "skills", name: "Skills", description: "" },
  )!;
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["skill-1", "load_skill", { name: "reports" }]))
    .mockResolvedValue(assistant("Done"));
  await runMessages(testClient(complete), "model", "", [], [], { middleware: provider.chat!.middleware });
  const load = telemetry.spans.find((span) => span.attributes["gen_ai.tool.name"] === "load_skill")!;
  expect(load.attributes["wingman.skill.source"]).toBe(source);
  expect(load.attributes).not.toHaveProperty("wingman.plugin.id");
  expect(JSON.stringify(telemetry.spans.map((span) => span.attributes))).not.toContain("Private");
});

it.each(["error", "aborted"] as const)("records configured agent outcome on %s", async (outcome) => {
  const controller = new AbortController();
  const complete = vi.fn().mockImplementation(async () => {
    if (outcome === "aborted") controller.abort();
    throw new Error("Generation stopped");
  });
  const result = await run(testClient(complete), "model", "", [], [], {
    agentIdentity: { id: "agent-1", name: "Research assistant", kind: "configured" },
    options: { signal: controller.signal },
  });
  expect(result.status).toBe(outcome === "error" ? "failed" : "aborted");
  const invocation = telemetry.spans.find((span) => span.attributes["gen_ai.operation.name"] === "invoke_agent");
  expect(invocation?.attributes["wingman.agent.outcome"]).toBe(outcome);
  for (const span of telemetry.spans) expect(span.end).toHaveBeenCalledOnce();
});

it("does not export unknown model-supplied skill identities", async () => {
  const provider = createSkillsProvider([{ name: "reports", description: "", loadContent: () => "Instructions" }], {
    id: "skills",
    name: "Skills",
    description: "",
  })!;
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["skill-1", "load_skill", { name: "Private hallucinated skill" }]))
    .mockResolvedValue(assistant("Done"));
  await runMessages(testClient(complete), "model", "", [], [], { middleware: provider.chat!.middleware });
  const load = telemetry.spans.find((span) => span.attributes["gen_ai.tool.name"] === "load_skill")!;
  expect(load.attributes).not.toHaveProperty("wingman.skill.id");
  expect(load.attributes).not.toHaveProperty("gen_ai.skill.name");
  expect(JSON.stringify(telemetry.spans.map((span) => span.attributes))).not.toContain("Private");
});

it("keeps the MCP agent identity when invoked through the realtime tool boundary", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(finished(response([textItem("Done")]))));
  const provider = createMcpAgentChat({ id: "internet", name: "Web research", tools: [] });
  await provider.tools[0].execute(
    { prompt: "Research" },
    {
      context: {
        model: "model",
        chatId: "voice-conversation",
        elicit: async () => ({ action: "accept" }),
      },
      emitCustomEvent() {},
    },
  );
  const child = telemetry.spans.find((span) => span.attributes["wingman.operation.name"] === provider.tools[0].name);
  expect(child?.attributes).toMatchObject({
    "gen_ai.agent.id": "mcp:internet",
    "gen_ai.agent.name": "Web research",
    "wingman.agent.kind": "delegated",
    "gen_ai.conversation.id": "voice-conversation",
  });
});
