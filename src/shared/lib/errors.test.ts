import { describe, expect, it } from "vitest";
import { getErrorInfo, isAbortError, isContextOverflowError } from "./errors";

describe("native provider error presentation", () => {
  it.each([
    [Object.assign(new Error("Too much context"), { code: "context_length_exceeded" }), "CONTEXT_EXHAUSTED"],
    [{ message: "Request rejected", code: "context_overflow" }, "CONTEXT_EXHAUSTED"],
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
    // TanStack's RUN_ERROR serialization drops the SDK exception's name.
    [{ message: "Request timed out.", code: undefined }, "TIMEOUT"],
    [{ message: "MCP error -32001: Request timed out", code: "-32001" }, "TIMEOUT"],
    [{ message: "Maximum total timeout exceeded", code: "REQUEST_TIMEOUT" }, "TIMEOUT"],
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

  it.each([
    { status: 400, message: "Invalid timeout parameter" },
    { status: 400, message: "timeout must be a positive integer" },
  ])("does not classify a rejected timeout setting as an expired request: %s", (error) => {
    expect(getErrorInfo(error).code).toBe("CLIENT_ERROR");
  });

  it.each([
    [0, "0 seconds"],
    [1, "1 second"],
    [1500, "2 seconds"],
    [65_000, "65 seconds"],
  ])("uses the advertised %s ms rate-limit delay", (retryAfterMs, wait) => {
    expect(getErrorInfo({ code: "429", metadata: { tanstack: { retryAfterMs } } })).toEqual({
      code: "RATE_LIMIT_ERROR",
      message: `Rate limit exceeded. Try again in ${wait}.`,
    });
    expect(getErrorInfo({ status: 429, retryAfterMs }).message).toContain(wait);
  });

  it.each([undefined, -1, NaN, Infinity, "2000"])("ignores invalid retry delays: %s", (retryAfterMs) => {
    expect(getErrorInfo({ code: "rate_limit_exceeded", retryAfterMs }).message).toBe(
      "Rate limit exceeded. Please wait a moment before trying again.",
    );
  });

  it("retains the formatted delay after ChatClient strips metadata but preserves the raw provider body", () => {
    const message = "Rate limit exceeded. Try again in 3 seconds.";
    expect(
      getErrorInfo(
        Object.assign(new Error(message), {
          code: "RATE_LIMIT_ERROR",
          rawEvent: { code: "rate_limit_exceeded", message: "Throttled" },
        }),
      ),
    ).toEqual({ code: "RATE_LIMIT_ERROR", message });
  });
});
