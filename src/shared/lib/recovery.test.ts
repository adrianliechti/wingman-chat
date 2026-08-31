import type { ResponseInputItem } from "openai/resources/responses/responses";
import { describe, expect, it } from "vitest";
import { dropOrphanFunctionCalls } from "./recovery";

describe("Responses API history recovery", () => {
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
