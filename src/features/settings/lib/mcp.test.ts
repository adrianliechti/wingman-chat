import { expect, it, vi } from "vitest";
import type { NativeMCPClient } from "./mcpNativeClient";
import type { Tool as McpTool } from "@modelcontextprotocol/client";
import type { Tool } from "@/shared/types/chat";
import { convertSchemaToJsonSchema } from "@tanstack/ai";
import { flattenToolSchema, MCPClient } from "./mcp";
import { mcpToolName } from "./mcpToolNames";
import { assistant, calls, testClient } from "@/shared/lib/test-support/ai";
import { chatSession, boundInterrupt } from "@/shared/lib/test-support/chatSession";
import { Globe } from "lucide-react";
import { resolveToolHeader, resolveToolInput, resolveToolOutput } from "@/features/chat/components/toolDisplay";

function approvedTool() {
  const callTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "Evidence" }] });
  const native = { callTool } as unknown as NativeMCPClient;
  const provider = new MCPClient("web", "https://mcp.example.test", "Web", "Search", undefined, undefined, true);
  const boundary = provider as unknown as {
    client: NativeMCPClient;
    toTool(tool: McpTool, client: NativeMCPClient): Tool;
  };
  boundary.client = native;
  return {
    callTool,
    tool: boundary.toTool(
      {
        name: "research",
        inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
      },
      native,
    ),
  };
}

it("presents Internet as a primary feature with readable research input and approval", () => {
  const native = {} as NativeMCPClient;
  const provider = new MCPClient(
    "internet",
    "https://example.test/mcp",
    "Web Search",
    "Access up-to-date information",
    undefined,
    "https://example.test/server-icon",
    true,
  );
  expect(provider.icon).toBe(Globe);
  const boundary = provider as unknown as { toTool(tool: McpTool, client: NativeMCPClient): Tool };
  const tool = boundary.toTool(
    {
      name: "web_research",
      description: "Server hint",
      inputSchema: { type: "object", properties: { instructions: { type: "string" } } },
    },
    native,
  );
  const args = { instructions: "Find recent primary sources.\nCompare their findings." };
  expect(tool.description).toContain("one concise, self-contained question");
  expect(resolveToolHeader(tool, tool.name, JSON.stringify(args), { running: true })).toMatchObject({
    Icon: Globe,
    label: "Researching the web…",
    preview: "Find recent primary sources. Compare their findings.",
  });
  expect(resolveToolHeader(tool, tool.name, JSON.stringify(args), {}).label).toBe("Deep research");
  expect(resolveToolInput(tool, JSON.stringify(args))).toEqual([
    { name: "Instructions", code: args.instructions, language: "markdown" },
  ]);
  expect(resolveToolOutput(tool, [{ type: "text", content: "## Findings" }])).toEqual({
    code: "## Findings",
    language: "markdown",
  });
  expect(resolveToolInput(tool, JSON.stringify({ ...args, focus: "news" }))[1]).toEqual({
    name: "Focus",
    code: "news",
    language: "text",
  });
});

it.each([true, false])("restores MCP approval before sending any input (approved=%s)", async (approved) => {
  const { tool, callTool } = approvedTool();
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["research-call", tool.name, { prompt: "Company details" }]))
    .mockResolvedValueOnce(assistant("Done"));
  const client = testClient(complete);
  const original = chatSession(client, [tool]);
  await original.ai.sendMessage("Research");
  expect(callTool).not.toHaveBeenCalled();
  await expect.poll(() => original.store.value?.resume?.pendingInterrupts?.length).toBe(1);
  original.ai.dispose();
  const elicit = vi.fn().mockRejectedValue(new Error("Do not approve twice"));
  const restored = chatSession(client, [tool], original.store, { createToolContext: () => ({ elicit }) });
  await expect.poll(() => restored.ai.getInterruptState().interrupts.length).toBe(1);
  const approval = boundInterrupt(restored.ai.getInterruptState().interrupts[0]);
  expect(approval.kind).toBe("tool-approval");
  approval.resolveInterrupt(approved);
  await expect.poll(() => restored.finished.at(-1)?.status).toBe("completed");
  expect(callTool).toHaveBeenCalledTimes(approved ? 1 : 0);
  if (approved) expect(callTool.mock.calls[0].slice(0, 2)).toEqual(["research", { prompt: "Company details" }]);
  expect(elicit).not.toHaveBeenCalled();
  restored.ai.dispose();
});

it.each(["accept", "decline", "cancel"])("requires pre-call elicitation in direct contexts: %s", async (action) => {
  const { tool, callTool } = approvedTool();
  const elicit = vi.fn().mockResolvedValue({ action });
  const execution = tool.execute({ prompt: "Company details" }, { context: { elicit }, emitCustomEvent() {} });
  if (action === "accept") await execution;
  else await expect(execution).rejects.toThrow("declined");
  expect(elicit.mock.calls[0][0].message).toContain("Company details");
  expect(callTool).toHaveBeenCalledTimes(action === "accept" ? 1 : 0);
});

it("fails closed when pre-call approval is unavailable", async () => {
  const { tool, callTool } = approvedTool();
  await expect(tool.execute({ prompt: "Company details" }, undefined)).rejects.toThrow("requires approval");
  expect(callTool).not.toHaveBeenCalled();
});

it("forwards cancellation to the native MCP call and retains stored tool names", async () => {
  const controller = new AbortController();
  const callTool = vi.fn(async (_name, _args, options) => {
    options.signal.throwIfAborted();
    return { content: [] };
  });
  const native = { callTool } as unknown as NativeMCPClient;
  const provider = new MCPClient("test", "https://mcp.example.test", "Test", "Test");
  const boundary = provider as unknown as {
    client: NativeMCPClient;
    toTool(tool: McpTool, client: NativeMCPClient): Tool;
  };
  boundary.client = native;
  const tool = boundary.toTool({ name: "cancel", inputSchema: { type: "object" } }, native);
  expect(tool.name).toBe(mcpToolName("test", "cancel"));
  controller.abort();
  await expect(
    tool.execute({}, { context: { signal: controller.signal }, emitCustomEvent() {} }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(callTool).toHaveBeenCalledWith(
    "cancel",
    {},
    { signal: expect.any(AbortSignal), timeout: 15 * 60_000, onprogress: expect.any(Function) },
  );
});

it("flattens top-level schema alternatives that model providers reject", () => {
  const search = {
    type: "object",
    properties: { query: { type: "string" }, queries: { type: "array", items: { type: "string" } } },
    anyOf: [{ required: ["query"] }, { required: ["queries"] }],
  };
  expect(flattenToolSchema(search)).toEqual({ type: "object", properties: search.properties });
  expect(
    flattenToolSchema({
      allOf: [
        { properties: { url: { type: "string" } }, required: ["url"] },
        { properties: { depth: { type: "number" } } },
      ],
    }),
  ).toEqual({ type: "object", properties: { url: { type: "string" }, depth: { type: "number" } }, required: ["url"] });
  const boundary = new MCPClient("web", "https://mcp.example.test", "Web", "Search") as unknown as {
    toTool(tool: McpTool, client: NativeMCPClient): Tool;
  };
  const converted = convertSchemaToJsonSchema(
    boundary.toTool({ name: "web_search", inputSchema: search as McpTool["inputSchema"] }, {} as NativeMCPClient)
      .inputSchema,
  ) as Record<string, unknown>;
  for (const key of ["anyOf", "oneOf", "allOf"]) expect(converted).not.toHaveProperty(key);
  expect(converted.properties).toHaveProperty("queries");
});
