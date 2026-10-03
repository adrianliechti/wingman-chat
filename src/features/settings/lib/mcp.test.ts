import { expect, it, vi } from "vitest";
import type { MCPClient as NativeMCPClient } from "@tanstack/ai-mcp";
import type { Tool as McpTool } from "@modelcontextprotocol/client";
import type { Tool } from "@/shared/types/chat";
import { MCPClient } from "./mcp";
import { mcpToolName } from "./mcpToolNames";

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
  expect(callTool).toHaveBeenCalledWith("cancel", {}, { signal: controller.signal });
});
