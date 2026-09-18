import { describe, expect, it, vi } from "vitest";
import type { Message, ReasoningContent } from "@/shared/types/chat";
import { toResponseInput } from "@/shared/lib/responses";
import { trimBulkyToolHistory } from "@/shared/lib/toolHistoryTrim";
import { compactIfNeeded, historyForRetry, prepareChatMessages, sanitizeForSummary } from "./chatHistory";

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string): Message => ({ role: "assistant", content: [{ type: "text", text }] });
const call = (id: string, args = "{}"): Message => ({
  role: "assistant",
  content: [{ type: "tool_call", id, name: "read", arguments: args }],
});
const output = (id: string, text: string): Message => ({
  role: "user",
  content: [{ type: "tool_result", id, name: "read", arguments: "{}", result: [{ type: "text", text }] }],
});
const feedback: Message = {
  role: "user",
  content: [{ type: "runtime_feedback", source: "verification", text: "Fix the missing deliverable." }],
};
const history = () => [user("Earlier request"), assistant("Earlier context ".repeat(200)), user("Current request")];
function options(summarizeHistory = vi.fn().mockResolvedValue("Earlier work is done.")) {
  return { threshold: 1, client: { summarizeHistory }, summarizerModel: "small", fallbackModel: "chat" };
}

describe("chat history and compaction", () => {
  it.each(["current_turn", "all_turns", undefined] as const)(
    "uses the effective reasoning context %s across human turns",
    async (reasoningContext) => {
      const messages: Message[] = [];
      for (let i = 0; i < 4; i++) {
        messages.push(user("Question"), {
          role: "assistant",
          content: [
            { type: "reasoning", id: `rs_${i}`, text: "", encryptedContent: "signed" },
            { type: "text", text: "Answer" },
          ],
          usage: { inputTokens: 100 + i * 20, outputTokens: 3005, reasoningTokens: 3000, reasoningContext },
        });
      }
      messages.push(user("Next question"));
      const opts = { ...options(), threshold: 10000 };
      const result = await compactIfNeeded(messages, opts);
      if (reasoningContext === "current_turn") {
        expect(opts.client.summarizeHistory).not.toHaveBeenCalled();
        expect(result).toBe(messages);
      } else {
        expect(opts.client.summarizeHistory).toHaveBeenCalledOnce();
        expect(result).not.toBe(messages);
      }
    },
  );

  it("removes the previous tool loop's reasoning from measured input on a new human turn", async () => {
    const messages: Message[] = [
      user("Work"),
      {
        role: "assistant",
        content: [{ type: "reasoning", id: "rs_tool", text: "", encryptedContent: "signed" }, ...call("a").content],
        usage: { inputTokens: 100, outputTokens: 9005, reasoningTokens: 9000, reasoningContext: "current_turn" },
      },
      output("a", "Evidence"),
      {
        role: "assistant",
        content: [
          { type: "reasoning", id: "rs_answer", text: "", encryptedContent: "signed" },
          { type: "text", text: "Done" },
        ],
        usage: { inputTokens: 9110, outputTokens: 2005, reasoningTokens: 2000, reasoningContext: "current_turn" },
      },
      user("Next question"),
    ];
    const opts = { ...options(), threshold: 1000 };
    expect(await compactIfNeeded(messages, opts)).toBe(messages);
    expect(opts.client.summarizeHistory).not.toHaveBeenCalled();

    // Preserve measured input costs that cannot be reconstructed from prose.
    messages[3].usage!.inputTokens = 15000;
    await compactIfNeeded(messages, opts);
    expect(opts.client.summarizeHistory).toHaveBeenCalledOnce();
  });

  it("does not reuse an older context mode when the latest response omits it", async () => {
    const messages: Message[] = [
      user("Earlier request"),
      {
        role: "assistant",
        content: [{ type: "reasoning", id: "rs_old", text: "", encryptedContent: "signed" }],
        usage: { reasoningTokens: 12000, reasoningContext: "current_turn" },
      },
      user("Continue"),
      assistant("Answer without context metadata"),
      user("Next question"),
    ];
    const opts = { ...options(), threshold: 10000 };
    expect(await compactIfNeeded(messages, opts)).not.toBe(messages);
    expect(opts.client.summarizeHistory).toHaveBeenCalledOnce();
  });

  it("retains current-turn reasoning after tool results and runtime feedback", async () => {
    const messages: Message[] = [
      user("Earlier request"),
      assistant("Earlier evidence ".repeat(200)),
      user("Work"),
      {
        role: "assistant",
        content: [{ type: "reasoning", id: "rs_tool", text: "", encryptedContent: "signed" }, ...call("a").content],
        usage: { inputTokens: 100, outputTokens: 12005, reasoningTokens: 12000, reasoningContext: "current_turn" },
      },
      output("a", "Evidence"),
      feedback,
    ];
    const opts = { ...options(), threshold: 10000 };
    const compacted = await compactIfNeeded(messages, opts);
    expect(opts.client.summarizeHistory).toHaveBeenCalledOnce();
    expect(prepareChatMessages(compacted).slice(1)).toEqual(messages.slice(2));
  });

  it.each(["text", "summary"] as const)(
    "accepts useful compaction of signed %s when a legacy gateway reported zero reasoning tokens",
    async (field) => {
      const messages: Message[] = [
        user("Work"),
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              id: "rs_tool",
              text: "",
              [field]: "thinking ".repeat(6000),
              encryptedContent: "signed",
            },
            ...call("a").content,
          ],
          usage: { inputTokens: 100, outputTokens: 15010, reasoningTokens: 0 },
        },
        output("a", "42"),
      ];
      const original = structuredClone(messages);
      const summarize = vi
        .fn()
        .mockResolvedValue("The tool returned 42; continue using that evidence to finish the requested work.");
      const compacted = await compactIfNeeded(messages, { ...options(summarize), threshold: 10000, force: true });
      expect(compacted).not.toBe(messages);
      expect(JSON.stringify(toResponseInput(prepareChatMessages(compacted))).length).toBeLessThan(1000);
      expect(messages).toEqual(original);
    },
  );

  it.each([true, false])(
    "compacts retained reasoning and releases only summarized payloads (usage=%s)",
    async (withUsage) => {
      const binding = { model: "chat", prefix: "prefix" };
      const signed = (id: string, encryptedContent: string): ReasoningContent => ({
        type: "reasoning",
        id,
        text: "",
        summary: "Plan",
        encryptedContent,
        ...binding,
      });
      const oldReasoning = signed("rs_old", withUsage ? "short-payload" : "opaque".repeat(2000));
      const currentReasoning = signed("rs_current", "current-payload");
      const messages: Message[] = [
        user("Earlier request"),
        {
          role: "assistant",
          content: [oldReasoning, { type: "text", text: "Earlier answer" }],
          ...(withUsage ? { usage: { inputTokens: 20, outputTokens: 3004, reasoningTokens: 3000 } } : {}),
        },
        user("Current request"),
        { role: "assistant", content: [currentReasoning, ...call("current").content] },
        output("current", "Current evidence"),
      ];
      const original = structuredClone(messages);
      const summarize = vi.fn().mockResolvedValue("Earlier work summarized, including its observed outcome.");
      const compacted = await compactIfNeeded(messages, { ...options(summarize), threshold: 1000 });
      expect(compacted).not.toBe(messages);
      expect(summarize).toHaveBeenCalledOnce();
      expect(JSON.stringify(summarize.mock.calls[0][1])).not.toContain("encryptedContent");
      expect(compacted[1].content[0]).toEqual({ type: "reasoning", id: "rs_old", text: "", summary: "Plan" });
      const input = toResponseInput(prepareChatMessages(compacted), { reasoning: binding });
      expect(input.filter((item) => item.type === "reasoning")).toEqual([
        expect.objectContaining({ id: "rs_current", encrypted_content: "current-payload" }),
      ]);
      expect(messages).toEqual(original);
      const again = await compactIfNeeded(compacted, { ...options(summarize), threshold: 1000 });
      expect(again).toBe(compacted);
      expect(summarize).toHaveBeenCalledOnce();
    },
  );

  it("preserves the full current turn and every tool pair during proactive compaction", async () => {
    const messages = [...history(), call("a"), output("a", "Current evidence"), feedback];
    const opts = options();
    const compacted = await compactIfNeeded(messages, opts);
    const prepared = prepareChatMessages(compacted);
    expect(prepared.slice(1)).toEqual(messages.slice(2));
    expect(
      toResponseInput(prepared).filter((item) => item.type === "function_call" || item.type === "function_call_output"),
    ).toHaveLength(2);
    expect(opts.client.summarizeHistory.mock.calls[0][1]).toEqual(sanitizeForSummary(messages.slice(0, 2)));
    expect(compacted.filter((message) => !message.content.some((part) => part.type === "summary"))).toEqual(messages);
    expect(compacted.find((message) => message.content.some((part) => part.type === "summary"))?.id).toBeTruthy();
  });

  it("recovers a large first-turn tool result without losing the exact request or feedback", async () => {
    const messages = [
      user("Create the requested report; preserve these exact constraints."),
      call("a"),
      output("a", "Evidence ".repeat(4000)),
      feedback,
    ];
    const opts = { ...options(), force: true };
    const compacted = await compactIfNeeded(messages, opts);
    expect(compacted).not.toBe(messages);
    const prepared = prepareChatMessages(compacted, "<context>Now</context>");
    expect(prepared[0].content).toEqual([{ type: "summary", text: "Earlier work is done." }]);
    expect(prepared[1].content).toEqual([...messages[0].content, { type: "text", text: "<context>Now</context>" }]);
    expect(prepared[2]).toEqual(feedback);
    expect(toResponseInput(prepared).some((item) => item.type === "function_call_output")).toBe(false);
    expect(JSON.stringify(opts.client.summarizeHistory.mock.calls[0][1]).length).toBeLessThan(2000);
  });

  it("bounds structured tool arguments in the summarizer even when no individual string is large", async () => {
    const args = JSON.stringify({ path: "/matrix.json", values: Array.from({ length: 10_000 }, (_, i) => i) });
    const messages = [user("Analyze the matrix"), call("a", args), output("a", "Matrix loaded")];
    const original = structuredClone(messages);
    const opts = { ...options(), force: true };
    const compacted = await compactIfNeeded(messages, opts);
    expect(JSON.stringify(opts.client.summarizeHistory.mock.calls[0][1]).length).toBeLessThan(2000);
    expect(compacted).not.toBe(messages);
    expect(messages).toEqual(original);
    expect(prepareChatMessages(compacted)[1]).toEqual(messages[0]);
  });

  it("keeps the exact request and feedback through repeated overflow compactions in one turn", async () => {
    const request = user("Do not change these exact constraints.");
    let messages = [request, call("a"), output("a", "First evidence ".repeat(1000)), feedback];
    messages = await compactIfNeeded(messages, { ...options(), force: true });
    messages.push(call("b"), output("b", "Second evidence ".repeat(1000)));
    const summarize = vi.fn().mockResolvedValue("Both evidence sources were inspected.");
    const compacted = await compactIfNeeded(messages, { ...options(summarize), force: true });
    expect(compacted).not.toBe(messages);
    expect(prepareChatMessages(compacted).slice(1)).toEqual([request, feedback]);
    expect(JSON.stringify(summarize.mock.calls[0][1])).toContain("Earlier work is done.");
    expect(JSON.stringify(summarize.mock.calls[0][1])).not.toContain("First evidence");
    expect(compacted.flatMap((message) => message.content).filter((part) => part.type === "summary")).toHaveLength(1);
  });

  it("retries from the full committed history, including a summary after the last tool result", async () => {
    const original = [user("Work"), call("a"), output("a", "Large result ".repeat(1000))];
    const compacted = await compactIfNeeded(original, { ...options(), force: true });
    const error: Message = {
      role: "assistant",
      content: [],
      error: { code: "NETWORK_ERROR", message: "Disconnected" },
    };
    expect(historyForRetry([...compacted, error])).toEqual(compacted);
    expect(historyForRetry([...compacted, error])?.at(-1)?.content[0].type).toBe("summary");
    expect(historyForRetry(compacted)).toBeNull();
  });

  it("chains summaries using only the active context while keeping the original transcript", async () => {
    const first = await compactIfNeeded(history(), options());
    const next = [...first, assistant("More context ".repeat(200)), user("Next request")];
    const opts = options(vi.fn().mockResolvedValue("All earlier work is done."));
    const second = await compactIfNeeded(next, opts);
    const payload = JSON.stringify(opts.client.summarizeHistory.mock.calls[0][1]);
    expect(payload).toContain("Earlier work is done.");
    expect(payload).not.toContain("Earlier context Earlier context");
    expect(second.flatMap((message) => message.content).filter((part) => part.type === "summary")).toHaveLength(1);
    expect(second.filter((message) => !message.content.some((part) => part.type === "summary"))).toEqual([
      ...history(),
      ...next.slice(-2),
    ]);
  });

  it("falls back once when the configured summarizer fails", async () => {
    const summarize = vi
      .fn()
      .mockRejectedValueOnce(new Error("Small window"))
      .mockResolvedValueOnce("A concise summary.");
    await compactIfNeeded(history(), options(summarize));
    expect(summarize.mock.calls.map(([model]) => model)).toEqual(["small", "chat"]);
    expect(summarize.mock.calls[0][1]).toEqual(summarize.mock.calls[1][1]);
  });

  it("propagates fallback failure without changing history", async () => {
    const messages = history();
    const original = structuredClone(messages);
    const error = new Error("Unavailable");
    await expect(compactIfNeeded(messages, options(vi.fn().mockRejectedValue(error)))).rejects.toBe(error);
    expect(messages).toEqual(original);
  });

  it("never falls back or commits a summary after cancellation", async () => {
    const controller = new AbortController();
    const summarize = vi.fn(async () => {
      controller.abort();
      return "Summary";
    });
    await expect(
      compactIfNeeded(history(), { ...options(summarize), signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(summarize).toHaveBeenCalledTimes(1);
    const cancelled = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    await expect(compactIfNeeded(history(), options(cancelled))).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it.each(["", "   ", "Expanded context ".repeat(2000)])(
    "does not commit empty or expanding summaries (%#)",
    async (summary) => {
      const messages = history();
      expect(await compactIfNeeded(messages, options(vi.fn().mockResolvedValue(summary)))).toBe(messages);
    },
  );

  it("honors disabled compaction and avoids summarizing the only human request", async () => {
    const opts = options();
    const messages = history();
    expect(await compactIfNeeded(messages, { ...opts, threshold: 0, force: true })).toBe(messages);
    const single = [user("Large input ".repeat(100))];
    expect(await compactIfNeeded(single, opts)).toBe(single);
    expect(opts.client.summarizeHistory).not.toHaveBeenCalled();
  });

  it("retains loaded skills across repeated compactions without dangling calls", async () => {
    const skill: Message = {
      role: "user",
      content: [
        {
          type: "tool_result",
          name: "read_skill",
          id: "s",
          arguments: "{}",
          result: [
            { type: "text", text: JSON.stringify({ name: "reports", instructions: "Always verify the report." }) },
          ],
        },
      ],
    };
    const messages = [user("Read the skill"), skill, assistant("Evidence ".repeat(1000)), user("Continue")];
    const first = await compactIfNeeded(messages, options());
    const second = await compactIfNeeded(
      [...first, assistant("More evidence ".repeat(1000)), user("Finish")],
      options(),
    );
    const prepared = prepareChatMessages(second);
    expect(JSON.stringify(prepared).match(/Always verify the report\./g)).toHaveLength(1);
    expect(toResponseInput(prepared).some((item) => item.type === "function_call_output")).toBe(false);
  });

  it("keeps current-turn images after tool results and strips only older images", () => {
    const old: Message = { role: "user", content: [{ type: "image", data: "data:image/png;base64,old" }] };
    const current: Message = { role: "user", content: [{ type: "image", data: "data:image/png;base64,current" }] };
    const prepared = prepareChatMessages([old, assistant("Previous"), current, call("a"), output("a", "OK"), feedback]);
    expect(prepared[0].content[0].type).toBe("text");
    expect(prepared[2]).toBe(current);
    expect(old.content[0].type).toBe("image");
  });

  it("does not count internal feedback as a human turn when trimming tool history", () => {
    const longOutput = output("a", "x".repeat(5000));
    const messages = [user("Work"), call("a"), longOutput, feedback, assistant("Still working"), feedback];
    expect(trimBulkyToolHistory(messages)).toBe(messages);
    expect(prepareChatMessages(messages)[2]).toBe(longOutput);
  });

  it("strips binary data, reasoning, and duplicated tool arguments from summaries", () => {
    const messages: Message[] = [
      { role: "assistant", content: [{ type: "reasoning", id: "r", text: "Hidden" }] },
      {
        role: "user",
        content: [
          { type: "image", data: "data:image/png;base64,large" },
          {
            type: "tool_result",
            id: "a",
            name: "read",
            arguments: "Duplicated arguments",
            result: [{ type: "image", data: "data:image/png;base64,large" }],
          },
        ],
      },
    ];
    const payload = JSON.stringify(sanitizeForSummary(messages));
    expect(payload).not.toContain("base64");
    expect(payload).not.toContain("Hidden");
    expect(payload).not.toContain("Duplicated arguments");
  });
});
