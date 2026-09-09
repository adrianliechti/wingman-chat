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

  async function invoke(parent?: ToolContext, work?: (context: ToolContext) => void) {
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
            work?.(context!);
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

  it("returns the final answer without the child agent's commentary", async () => {
    state.complete.mockReset().mockResolvedValueOnce({
      role: "assistant",
      content: [
        { type: "text", text: "Working", phase: "commentary" },
        { type: "text", text: "Done", phase: "final_answer" },
      ],
    });
    const tool = createSubagentTool("model", "Instructions", []);
    expect(await tool.function({ prompt: "Question" })).toEqual([{ type: "text", text: "Done" }]);
  });

  it("retains the parent's invocation budget but gives the child its own branch and run ID", async () => {
    const invocationContext = new AgentInvocationContext({ maxModelCalls: 5 });
    const child = await invoke({ runId: "chat-parent", invocationContext });
    expect(child.runId).not.toBe("chat-parent");
    expect(child.invocationContext?.invocationId).toBe(invocationContext.invocationId);
    expect(child.invocationContext?.branch).toBe("subagent");
    expect(invocationContext.budgetSnapshot()).toEqual({ used: 2, limit: 5 });
  });

  it("preserves attached image references and elicitation for delegated tools", async () => {
    const content: ToolContext["content"] = () => [{ type: "image", data: "data:image/png;base64,aW1hZ2U=" }];
    const elicit = vi.fn().mockResolvedValue({ action: "accept" });
    const child = await invoke({ chatId: "origin-chat", content, elicit });
    expect(child.content?.()).toEqual(content());
    await child.elicit?.({ message: "Generate an image" });
    expect(elicit).toHaveBeenCalledExactlyOnceWith({ message: "Generate an image" });
  });

  it.each([false, true])(
    "reports committed file changes to the parent even when a later model call fails: %s",
    async (fail) => {
      if (fail) {
        state.complete
          .mockReset()
          .mockResolvedValueOnce({
            role: "assistant",
            content: [{ type: "tool_call", id: "inspect-call", name: "inspect", arguments: "{}" }],
          })
          .mockRejectedValueOnce(new Error("Later model request failed"));
      }
      const setMeta = vi.fn();
      const mutations = [
        { operation: "create", path: "/game.html" },
        { operation: "create", path: "/lib/three.js" },
      ];
      await invoke({ chatId: "origin-chat", setMeta }, (context) => {
        context.setMeta?.({ artifactDelta: { mutations } });
      });
      expect(setMeta).toHaveBeenCalledWith(expect.objectContaining({ artifactDelta: { mutations } }));
    },
  );
});
