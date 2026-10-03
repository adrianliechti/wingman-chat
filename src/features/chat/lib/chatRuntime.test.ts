import type { UIMessage } from "@tanstack/ai";
import { describe, expect, it } from "vitest";
import { retryHistory, withRunError } from "./chatRuntime";

const error = { code: "SERVER_ERROR", message: "Server error." };
const user = (id: string, text = "Go"): UIMessage => ({ id, role: "user", parts: [{ type: "text", content: text }] });
const assistant = (id: string, parts: UIMessage["parts"], metadata?: UIMessage["metadata"]): UIMessage => ({
  id,
  role: "assistant",
  parts,
  ...(metadata ? { metadata } : {}),
});
const call = (id: string): UIMessage["parts"][number] => ({
  type: "tool-call",
  id,
  name: "work",
  arguments: "{}",
  state: "complete",
});
const result = (id: string): UIMessage["parts"][number] => ({
  type: "tool-result",
  toolCallId: id,
  content: "Done",
  state: "complete",
});
const text = (content: string): UIMessage["parts"][number] => ({ type: "text", content });
const thinking: UIMessage["parts"][number] = { type: "thinking", content: "Plan" };

describe("withRunError", () => {
  it("ends the transcript with an assistant turn carrying the error", () => {
    const next = withRunError([user("u")], error);
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ role: "assistant", parts: [], metadata: { error } });
  });

  it("replaces the empty assistant the runtime opened for the failed run", () => {
    const next = withRunError([user("u"), assistant("empty", [])], error);
    expect(next.map((message) => message.id)).toEqual(["u", expect.any(String)]);
    expect(next[1].id).not.toBe("empty");
  });

  it("keeps a partial answer visible before the error", () => {
    const next = withRunError([user("u"), assistant("partial", [text("Half")])], error);
    expect(next.map((message) => message.parts.length)).toEqual([1, 1, 0]);
  });
});

describe("retryHistory", () => {
  it("returns nothing unless the transcript ends in a failed assistant turn", () => {
    expect(retryHistory([user("u")])).toBeUndefined();
    expect(retryHistory([user("u"), assistant("a", [text("Answer")])])).toBeUndefined();
    expect(retryHistory([assistant("a", [], { error })])).toBeUndefined();
  });

  it("regenerates a partial answer from the user turn", () => {
    const retry = retryHistory([
      user("u"),
      assistant("partial", [thinking, text("Half")]),
      assistant("failed", [], { error }),
    ]);
    expect(retry).toEqual({ history: [], resend: user("u") });
  });

  it("ignores the runtime's empty assistant after the error turn", () => {
    const retry = retryHistory([user("u"), assistant("failed", [], { error }), assistant("empty", [])]);
    expect(retry).toEqual({ history: [], resend: user("u") });
  });

  it("continues from committed tool results and drops work after them", () => {
    const retry = retryHistory([
      user("u"),
      assistant("work", [call("one"), result("one"), text("Next"), call("two")]),
      assistant("failed", [], { error }),
    ]);
    expect(retry?.history).toEqual([user("u")]);
    expect(retry?.resend).toEqual(assistant("work", [call("one"), result("one")]));
  });

  it("strips a legacy error stored on the turn that holds the committed work", () => {
    const retry = retryHistory([
      user("u"),
      assistant("work", [call("one"), result("one"), text("Half")], { error, runId: "run" }),
    ]);
    expect(retry?.resend).toEqual(assistant("work", [call("one"), result("one")], { runId: "run" }));
  });

  it("needs a user turn to resend", () => {
    expect(retryHistory([assistant("partial", [text("Half")]), assistant("failed", [], { error })])).toBe(undefined);
  });
});
