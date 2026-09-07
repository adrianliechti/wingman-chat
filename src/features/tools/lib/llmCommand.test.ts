import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/shared/lib/client";
import { AgentInvocationContext } from "@/shared/lib/agent-run-controller";
import { runLlm, setModel } from "./llmCommand";
import { runVision } from "./visionCommand";

const { complete, vision } = vi.hoisted(() => ({
  complete: vi.fn<Client["complete"]>(),
  vision: { files: [], model: undefined as string | undefined },
}));
vi.mock("@/shared/config", () => ({ getConfig: () => ({ client: { complete }, vision }) }));
beforeEach(() => {
  complete.mockReset().mockResolvedValue({ role: "assistant", content: [{ type: "text", text: "Answer" }] });
  vision.model = undefined;
  setModel("ui-model");
});

describe("interpreter model calls", () => {
  it.each(["llm", "vision"])("returns only the final answer from %s when commentary is also JSON", async (helper) => {
    complete.mockResolvedValueOnce({
      role: "assistant",
      content: [
        { type: "text", text: '{"content":"working"}', phase: "commentary" },
        { type: "text", text: '{"content":"done"}', phase: "final_answer" },
      ],
    });
    const result =
      helper === "llm" ? await runLlm("Question") : await runVision(new Uint8Array([1]), "/image.png", "Describe");
    expect(JSON.parse(result)).toEqual({ content: "done" });
  });

  it("starts every LLM and vision call with fresh history, including calls sharing an invocation", async () => {
    const context = { model: "run-model", invocationContext: new AgentInvocationContext() };
    await runLlm("First private question", { system: "First private instructions" }, { context });
    await runVision(new Uint8Array([1]), "/first.png", "First image question", { context });
    await runLlm("Independent question", {}, { context });
    await runVision(new Uint8Array([2]), "/second.png", "Independent image question", { context });

    expect(complete.mock.calls.map(([, system]) => system)).toEqual(["First private instructions", "", "", ""]);
    expect(complete.mock.calls.map(([, , messages]) => messages)).toEqual([
      [{ role: "user", content: [{ type: "text", text: "First private question" }] }],
      [
        {
          role: "user",
          content: [
            { type: "image", name: "first.png", data: "data:image/png;base64,AQ==" },
            { type: "text", text: "First image question" },
          ],
        },
      ],
      [{ role: "user", content: [{ type: "text", text: "Independent question" }] }],
      [
        {
          role: "user",
          content: [
            { type: "image", name: "second.png", data: "data:image/png;base64,Ag==" },
            { type: "text", text: "Independent image question" },
          ],
        },
      ],
    ]);
    expect(complete.mock.calls.map(([, , , tools]) => tools)).toEqual([[], [], [], []]);
  });

  it("keeps the configured vision model independent of the parent model", async () => {
    vision.model = "vision-specialist";
    await runVision(new Uint8Array([1]), "/image.png", "Describe", { context: { model: "parent" } });
    expect(complete.mock.calls[0][0]).toBe("vision-specialist");
  });

  it.each(["llm", "vision"])("honors invocation-only cancellation for %s without spending budget", async (helper) => {
    const parent = new AbortController();
    parent.abort();
    const invocationContext = new AgentInvocationContext({ signal: parent.signal, maxModelCalls: 1 });
    const request = { context: { invocationContext }, signal: new AbortController().signal };
    await expect(
      helper === "llm"
        ? runLlm("Question", {}, request)
        : runVision(new Uint8Array([1]), "/image.png", "Describe", request),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(complete).not.toHaveBeenCalled();
    expect(invocationContext.budgetSnapshot().used).toBe(0);
  });

  it("cancels an in-flight helper when its parent invocation stops", async () => {
    const parent = new AbortController();
    complete.mockImplementationOnce(async (_model, _system, _messages, _tools, _stream, options) => {
      parent.abort();
      options?.signal?.throwIfAborted();
      return { role: "assistant", content: [{ type: "text", text: "Should not finish" }] };
    });
    await expect(
      runLlm(
        "Question",
        {},
        {
          signal: new AbortController().signal,
          context: { invocationContext: new AgentInvocationContext({ signal: parent.signal }) },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses the captured run model even after the UI selection changes", async () => {
    const context = { model: "run-model", invocationContext: new AgentInvocationContext({ maxModelCalls: 2 }) };
    await runLlm("Question", {}, { context });
    await runVision(new Uint8Array([1]), "/image.png", "Describe", { context });
    expect(complete.mock.calls.map(([model]) => model)).toEqual(["run-model", "run-model"]);
    expect(context.invocationContext.budgetSnapshot()).toEqual({ used: 2, limit: 2 });
  });

  it("shares the parent's budget across LLM and vision requests", async () => {
    const context = { model: "run-model", invocationContext: new AgentInvocationContext({ maxModelCalls: 1 }) };
    await runLlm("Question", { model: "override" }, { context });
    await expect(runVision(new Uint8Array([1]), "/image.png", "Describe", { context })).rejects.toMatchObject({
      code: "MAX_TURNS",
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toBe("override");
  });

  it("does not consume budget or call the model after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const context = { invocationContext: new AgentInvocationContext({ maxModelCalls: 1 }) };
    await expect(runLlm("Question", {}, { context, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(context.invocationContext.budgetSnapshot().used).toBe(0);
    expect(complete).not.toHaveBeenCalled();
  });
});
