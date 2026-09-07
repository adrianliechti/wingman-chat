import type { ResponseInputItem } from "openai/resources/responses/responses";
import { describe, expect, it } from "vitest";
import { dropOrphanFunctionCalls } from "./recovery";

describe("Responses API history recovery", () => {
  const call = (id: string): ResponseInputItem => ({
    type: "function_call",
    call_id: id,
    name: "read",
    arguments: "{}",
  });
  const output = (id: string): ResponseInputItem => ({ type: "function_call_output", call_id: id, output: "ok" });

  it("keeps complete siblings when an interrupted turn leaves an orphan", () => {
    const text: ResponseInputItem = { role: "assistant", content: "Working" };
    const items = [text, call("a"), call("b"), output("a"), output("unknown")];
    expect(dropOrphanFunctionCalls(items)).toEqual([text, items[1], items[3]]);
  });

  it("does not correlate an output with a call that appears later in history", () => {
    expect(dropOrphanFunctionCalls([output("a"), call("a")])).toEqual([]);
  });

  it("deduplicates calls and results while preserving parallel result order", () => {
    const items = [call("a"), call("b"), call("a"), output("b"), output("a"), output("a")];
    expect(dropOrphanFunctionCalls(items)).toEqual([items[0], items[1], items[3], items[4]]);
  });

  it("rejects empty IDs and does not modify the original batch", () => {
    const items = [call(""), output(""), call("a"), output("a")];
    const original = structuredClone(items);
    expect(dropOrphanFunctionCalls(items)).toEqual(items.slice(2));
    expect(items).toEqual(original);
  });
  it("drops function outputs without call IDs while preserving valid pairs", () => {
    const call: ResponseInputItem = {
      type: "function_call",
      call_id: "call_1",
      name: "example",
      arguments: "{}",
    };
    const output: ResponseInputItem = {
      type: "function_call_output",
      call_id: "call_1",
      output: "done",
    };
    const missingId: ResponseInputItem = {
      type: "function_call_output",
      output: "invalid",
    };
    const nullId: ResponseInputItem = {
      type: "function_call_output",
      call_id: null,
      output: "invalid",
    };

    expect(dropOrphanFunctionCalls([call, output, missingId, nullId])).toEqual([call, output]);
  });
});
