import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/shared/types/chat";
import { AgentInvocationContext } from "@/shared/lib/agent-run-controller";
import { createSubagentTool } from "./subagent";

const state = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@/shared/config", () => ({ getConfig: () => ({ client: { complete: state.complete } }) }));

describe("subagent invocation identity", () => {
  beforeEach(() => {
    state.complete.mockReset();
    state.complete.mockResolvedValueOnce({
      role: "assistant",
      content: [{ type: "tool_call", id: "inspect-call", name: "inspect", arguments: "{}" }],
    });
    state.complete.mockResolvedValueOnce({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    });
  });

  async function invoke(parent?: ToolContext) {
    let child: ToolContext | undefined;
    const tool = createSubagentTool(
      "model",
      "Static instructions",
      [
        {
          name: "inspect",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          function: async (_args, context) => {
            child = context;
            return [{ type: "text", text: "ok" }];
          },
        },
      ],
      "active_file: /current.md",
    );
    await tool.function({ prompt: "Inspect the file" }, parent);
    expect(child?.runId).toBeTruthy();
    expect(state.complete).toHaveBeenCalledTimes(2);
    const request = state.complete.mock.calls[0];
    expect(request[1]).not.toContain("active_file");
    expect(JSON.stringify(request[2])).toContain("active_file: /current.md");
    return child!;
  }

  it("marks children even when invoked from voice without a parent invocation context", async () => {
    const child = await invoke({ runId: "voice-parent", chatId: "origin-chat" });
    expect(child.chatId).toBe("origin-chat");
    expect(child.runId).not.toBe("voice-parent");
    expect(child.invocationContext?.branch).toBe("subagent");
  });

  it("retains the parent's invocation budget but gives the child its own branch and run ID", async () => {
    const invocationContext = new AgentInvocationContext({ maxModelCalls: 5 });
    const child = await invoke({ runId: "chat-parent", invocationContext });
    expect(child.runId).not.toBe("chat-parent");
    expect(child.invocationContext?.invocationId).toBe(invocationContext.invocationId);
    expect(child.invocationContext?.branch).toBe("subagent");
    expect(invocationContext.budgetSnapshot()).toEqual({ used: 2, limit: 5 });
  });
});
