import { describe, expect, it, vi } from "vitest";
import { MCPClient } from "./mcp";

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
    controller.abort();

    await expect(provider.tools[0].function({}, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(callTool).toHaveBeenCalledOnce();
  });
});
