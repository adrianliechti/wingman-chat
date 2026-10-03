import { describe, expect, it } from "vitest";
import { getErrorInfo, isAbortError, isContextOverflowError } from "./errors";

describe("native provider error presentation", () => {
  it.each([
    [Object.assign(new Error("Too much context"), { code: "context_length_exceeded" }), "CONTEXT_EXHAUSTED"],
    [
      Object.assign(new Error("Bad request"), {
        rawEvent: { code: "context_length_exceeded", message: "Input too long" },
      }),
      "CONTEXT_EXHAUSTED",
    ],
    [Object.assign(new Error("max_output_tokens"), { code: "incomplete" }), "OUTPUT_TRUNCATED"],
    [Object.assign(new Error("Filtered"), { code: "content_filter" }), "CONTENT_FILTERED"],
    [Object.assign(new Error("Throttled"), { code: "rate_limit_exceeded" }), "RATE_LIMIT_ERROR"],
    [Object.assign(new Error("Unavailable"), { status: 503 }), "SERVER_ERROR"],
    [Object.assign(new Error("Bad key"), { code: "invalid_api_key" }), "AUTH_ERROR"],
    [new TypeError("Failed to fetch"), "NETWORK_ERROR"],
    [new DOMException("The operation was aborted due to timeout", "TimeoutError"), "TIMEOUT"],
    [Object.assign(new Error("Request timed out"), { name: "APIConnectionTimeoutError" }), "TIMEOUT"],
    [new DOMException("Stopped", "AbortError"), "CANCELLED"],
  ])("presents %s as %s", (error, code) => expect(getErrorInfo(error).code).toBe(code));
  it("distinguishes input overflow from output truncation and preserves typed domain errors", () => {
    expect(isContextOverflowError(new Error("max_output_tokens"))).toBe(false);
    expect(isAbortError(Object.assign(new Error("Stopped"), { name: "APIUserAbortError" }))).toBe(true);
    expect(getErrorInfo(Object.assign(new Error("Bound reached"), { code: "MAX_TURNS" }))).toEqual({
      code: "MAX_TURNS",
      message: "Bound reached",
    });
  });
  it("explains deadline expiry without calling it a cancellation or lost connection", () => {
    expect(getErrorInfo(new DOMException("signal aborted", "TimeoutError"))).toEqual({
      code: "TIMEOUT",
      message: "Request timed out. Please try again.",
    });
    expect(getErrorInfo(Object.assign(new Error("Web search timed out after 90s"), { code: "TIMEOUT" }))).toEqual({
      code: "TIMEOUT",
      message: "Web search timed out after 90s",
    });
  });
});
