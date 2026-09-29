import { beforeEach, describe, expect, it, vi } from "vitest";
import { testClient } from "@/shared/lib/test-support/ai";
import { runLlm, setModel } from "./llmCommand";
import { runVision } from "./visionCommand";

const { complete, vision } = vi.hoisted(() => ({
  complete: vi.fn<Parameters<typeof testClient>[0]>(),
  vision: { files: [], model: undefined as string | undefined },
}));
vi.mock("@/shared/config", () => ({ getConfig: () => ({ client: testClient(complete), vision }) }));
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
    const context = { model: "run-model", invocationContext: {} };
    await runLlm("First private question", { system: "First private instructions" }, { context });
    await runVision(new Uint8Array([1]), "/first.png", "First image question", { context });
    await runLlm("Independent question", {}, { context });
    await runVision(new Uint8Array([2]), "/second.png", "Independent image question", { context });

    expect(complete.mock.calls.map(([options]) => options.systemPrompts)).toEqual([
      ["First private instructions"],
      [""],
      [""],
      [""],
    ]);
    expect(
      complete.mock.calls.map(([options]) => options.messages.map(({ role, content }) => ({ role, content }))),
    ).toEqual([
      [{ role: "user", content: "First private question" }],
      [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "data", value: "AQ==", mimeType: "image/png" },
              metadata: { filename: "first.png" },
            },
            { type: "text", content: "First image question" },
          ],
        },
      ],
      [{ role: "user", content: "Independent question" }],
      [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "data", value: "Ag==", mimeType: "image/png" },
              metadata: { filename: "second.png" },
            },
            { type: "text", content: "Independent image question" },
          ],
        },
      ],
    ]);
    expect(complete.mock.calls.map(([options]) => options.tools)).toEqual([[], [], [], []]);
  });

  it("keeps the configured vision model independent of the parent model", async () => {
    vision.model = "vision-specialist";
    await runVision(new Uint8Array([1]), "/image.png", "Describe", { context: { model: "parent" } });
    expect(complete.mock.calls[0][0].model).toBe("vision-specialist");
  });

  it.each(["llm", "vision"])("honors parent cancellation for %s", async (helper) => {
    const parent = new AbortController();
    parent.abort();
    const invocationContext = { signal: parent.signal };
    const request = { context: { invocationContext }, signal: new AbortController().signal };
    await expect(
      helper === "llm"
        ? runLlm("Question", {}, request)
        : runVision(new Uint8Array([1]), "/image.png", "Describe", request),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("cancels an in-flight helper when its parent invocation stops", async () => {
    const parent = new AbortController();
    complete.mockImplementationOnce(async (options) => {
      parent.abort();
      options.abortController?.signal.throwIfAborted();
      return { role: "assistant", content: [{ type: "text", text: "Should not finish" }] };
    });
    await expect(
      runLlm(
        "Question",
        {},
        {
          signal: new AbortController().signal,
          context: { invocationContext: { signal: parent.signal } },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses the captured run model even after the UI selection changes", async () => {
    const context = { model: "run-model", invocationContext: {} };
    await runLlm("Question", {}, { context });
    await runVision(new Uint8Array([1]), "/image.png", "Describe", { context });
    expect(complete.mock.calls.map(([options]) => options.model)).toEqual(["run-model", "run-model"]);
  });

  it("allows independent LLM and vision requests in the same parent context", async () => {
    const context = { model: "run-model", invocationContext: {} };
    await runLlm("Question", { model: "override" }, { context });
    await expect(runVision(new Uint8Array([1]), "/image.png", "Describe", { context })).resolves.toBe("Answer");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][0].model).toBe("override");
  });

  it("does not call the model after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const context = { invocationContext: {} };
    await expect(runLlm("Question", {}, { context, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(complete).not.toHaveBeenCalled();
  });
});
