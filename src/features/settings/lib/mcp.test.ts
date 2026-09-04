import { describe, expect, it, vi } from "vitest";
import { MCPClient } from "./mcp";
import { mcpToolName } from "./mcpToolNames";

describe("MCP tool execution", () => {
  it("forwards the harness abort signal to the SDK request", async () => {
    const controller = new AbortController();
    const callTool = vi.fn(async (_params: unknown, _schema: unknown, options?: { signal?: AbortSignal }) => {
      expect(options?.signal).toBe(controller.signal);
      options?.signal?.throwIfAborted();
      return { content: [{ type: "text" as const, text: "unreachable" }] };
    });
    const sdkClient = {
      getInstructions: () => undefined,
      listTools: async () => ({
        tools: [{ name: "cancel_me", description: "Cancellation fixture", inputSchema: { type: "object" } }],
      }),
      callTool,
    };
    const provider = new MCPClient("test", "https://mcp.example.test", "Test", "Test provider");
    const internals = provider as unknown as {
      client: typeof sdkClient;
      loadToolsAndInstructions(): Promise<void>;
    };
    internals.client = sdkClient;
    await internals.loadToolsAndInstructions();
    expect(provider.tools[0].name).toBe(mcpToolName("test", "cancel_me"));
    expect(provider.toolDefinitions.get(provider.tools[0].name)?.name).toBe("cancel_me");
    expect(provider.toolDefinitions.get("cancel_me")?.name).toBe("cancel_me");
    controller.abort();

    await expect(provider.tools[0].function({}, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(callTool).toHaveBeenCalledOnce();
    expect(callTool.mock.calls[0][0]).toEqual({ name: "cancel_me", arguments: {} });
  });
});
