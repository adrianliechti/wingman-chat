import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/shared/lib/client";
import { AgentInvocationContext } from "@/shared/lib/agent-run-controller";
import { runLlm, setModel } from "./llmCommand";
import { runVision } from "./visionCommand";

const complete = vi.hoisted(() => vi.fn<Client["complete"]>());
vi.mock("@/shared/config", () => ({ getConfig: () => ({ client: { complete }, vision: { files: [] } }) }));
beforeEach(() => {
  complete.mockReset().mockResolvedValue({ role: "assistant", content: [{ type: "text", text: "Answer" }] });
  setModel("ui-model");
});

describe("interpreter model calls", () => {
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
