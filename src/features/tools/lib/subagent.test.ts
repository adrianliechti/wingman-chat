import { toolCallMessage } from "@/shared/lib/test-support/ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inlineSkill, withSkills } from "@tanstack/ai-skills";
import type { ToolContext } from "@/shared/types/chat";
import { assistantMessage, mediaFromDataUrl, text } from "@/shared/lib/messages";
import { testClient } from "@/shared/lib/test-support/ai";
import { createSubagentTool } from "./subagent";

const state = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@/shared/config", () => ({ getConfig: () => ({ client: testClient(state.complete) }) }));

describe("subagent invocation identity", () => {
  beforeEach(() => {
    state.complete.mockReset();
    state.complete.mockResolvedValueOnce(toolCallMessage([{ id: "inspect-call", name: "inspect", arguments: "{}" }]));
    state.complete.mockResolvedValueOnce(assistantMessage("done"));
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
            return [{ type: "text", content: "ok" }];
          },
        },
      ],
      "active_file: /current.md",
    );
    await tool.function({ prompt: "Inspect the file" }, parent);
    expect(child?.runId).toBeTruthy();
    expect(state.complete).toHaveBeenCalledTimes(2);
    const request = state.complete.mock.calls[0];
    expect(request[0].systemPrompts).not.toContain("active_file");
    expect(JSON.stringify(request[0].messages)).toContain("active_file: /current.md");
    return child!;
  }

  it("marks children even when invoked from voice without a parent invocation context", async () => {
    const child = await invoke({ runId: "voice-parent", chatId: "origin-chat" });
    expect(child.chatId).toBe("origin-chat");
    expect(child.runId).not.toBe("voice-parent");
    expect(child.invocationContext?.subagentRunId).toBeTruthy();
  });

  it("applies provider middleware independently to each delegated run", async () => {
    const tool = createSubagentTool("model", "", [], "", [
      withSkills(
        inlineSkill({
          name: "reports",
          description: "Create reports",
          instructions: "Verify the report.",
        }),
      ),
    ]);
    for (const parent of [undefined, { runId: "voice-parent" }]) {
      state.complete
        .mockReset()
        .mockResolvedValueOnce(toolCallMessage([{ id: "skill", name: "load_skill", arguments: '{"name":"reports"}' }]))
        .mockResolvedValueOnce(assistantMessage("Verified"));
      expect(await tool.function({ prompt: "Build a report" }, parent)).toEqual([
        { type: "text", content: "Verified" },
      ]);
      expect(JSON.stringify(state.complete.mock.calls[0][0].systemPrompts)).toContain("Create reports");
      expect(JSON.stringify(state.complete.mock.calls[1][0].messages)).toContain("Verify the report.");
    }
  });

  it("returns the final answer without the child agent's commentary", async () => {
    state.complete
      .mockReset()
      .mockResolvedValueOnce(
        assistantMessage([text("Working", { phase: "commentary" }), text("Done", { phase: "final_answer" })]),
      );
    const tool = createSubagentTool("model", "Instructions", []);
    expect(await tool.function({ prompt: "Question" })).toEqual([{ type: "text", content: "Done" }]);
  });

  it("asks voice callers to continue in chat when a delegated tool needs native approval", async () => {
    const execute = vi.fn();
    const tool = createSubagentTool("model", "", [
      {
        name: "inspect",
        parameters: { type: "object" },
        needsApproval: true,
        function: execute,
      },
    ]);
    const result = await tool.function({ prompt: "Inspect" }, { elicit: vi.fn() });
    expect(result).toEqual([{ type: "text", content: "This task needs interactive input. Continue it in chat." }]);
    expect(execute).not.toHaveBeenCalled();
    expect(state.complete).toHaveBeenCalledOnce();
  });

  it("gives the child its own workspace context and run ID", async () => {
    const invocationContext = {};
    const child = await invoke({ runId: "chat-parent", invocationContext });
    expect(child.runId).not.toBe("chat-parent");
    expect(child.invocationContext).not.toBe(invocationContext);
    expect(child.invocationContext?.subagentRunId).toBeTruthy();
  });

  it("preserves attached image references and elicitation for delegated tools", async () => {
    const content: ToolContext["content"] = () => [mediaFromDataUrl("data:image/png;base64,aW1hZ2U=")];
    const elicit = vi.fn().mockResolvedValue({ action: "accept" });
    const child = await invoke({ chatId: "origin-chat", content, elicit });
    expect(child.content?.()).toEqual(content!());
    await child.elicit?.({ message: "Generate an image" });
    expect(elicit).toHaveBeenCalledExactlyOnceWith({ message: "Generate an image" });
  });

  it.each([false, true])(
    "reports committed file changes to the parent even when a later model call fails: %s",
    async (fail) => {
      if (fail) {
        state.complete
          .mockReset()
          .mockResolvedValueOnce(toolCallMessage([{ id: "inspect-call", name: "inspect", arguments: "{}" }]))
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
