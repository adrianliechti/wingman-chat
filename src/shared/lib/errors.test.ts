import { APIError, APIConnectionError, BadRequestError, RateLimitError, LengthFinishReasonError } from "openai/error";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getErrorInfo,
  getRetryAfterMs,
  isContextOverflowError,
  isReasoningReplayError,
  isRecoverableStreamError,
  waitBeforeStreamRetry,
} from "./errors";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LLM error classification", () => {
  it("recognizes both HTTP and streaming context overflow errors", () => {
    for (const error of [
      new BadRequestError(400, { code: "context_length_exceeded" }, "Too large", new Headers()),
      new APIError(undefined, { code: "context_length_exceeded" }, "Too large", new Headers()),
      new BadRequestError(400, { message: "Prompt is too long" }, "Prompt is too long", new Headers()),
      new APIError(413, { message: "Input too long" }, "Input too long", new Headers()),
    ]) {
      expect(isContextOverflowError(error)).toBe(true);
      expect(getErrorInfo(error).code).toBe("CONTEXT_EXHAUSTED");
      expect(isRecoverableStreamError(error)).toBe(false);
    }
  });

  it("does not mistake output limits or unrelated validation for context overflow", () => {
    for (const error of [
      new LengthFinishReasonError(),
      new BadRequestError(400, {}, "Tool name is too long", new Headers()),
    ]) {
      expect(isContextOverflowError(error)).toBe(false);
    }
    expect(getErrorInfo(new LengthFinishReasonError()).code).toBe("OUTPUT_TRUNCATED");
  });

  it("recognizes rejected reasoning payloads in OpenAI and Anthropic wording", () => {
    for (const error of [
      new BadRequestError(400, { code: "invalid_encrypted_content" }, "Bad payload", new Headers()),
      new APIError(413, { code: "invalid_encrypted_content" }, "Bad payload", new Headers()),
      new APIError(422, { code: "invalid_encrypted_content" }, "Bad payload", new Headers()),
      new APIError(undefined, { code: "invalid_encrypted_content" }, "Bad payload", undefined),
      new BadRequestError(400, { message: "The encrypted content could not be verified." }, "Bad", new Headers()),
      new BadRequestError(400, { message: "thinking block: invalid signature" }, "Bad", new Headers()),
      new BadRequestError(
        400,
        { message: "Item 'rs_1' of type 'reasoning' was provided without its required following item." },
        "Bad",
        new Headers(),
      ),
    ]) {
      expect(isReasoningReplayError(error)).toBe(true);
      expect(isContextOverflowError(error)).toBe(false);
    }
    for (const error of [
      new BadRequestError(400, { code: "context_length_exceeded" }, "Too large", new Headers()),
      new APIError(422, { message: "Unrelated validation error" }, "Bad", new Headers()),
      new APIError(401, { code: "invalid_encrypted_content" }, "Unauthorized", new Headers()),
      new APIError(403, { message: "thinking block: invalid signature" }, "Forbidden", new Headers()),
      new APIError(500, { message: "encrypted content could not be verified" }, "Down", new Headers()),
      new Error("invalid_encrypted_content"),
    ]) {
      expect(isReasoningReplayError(error)).toBe(false);
    }
  });

  it("preserves an agent's terminal error detail", () => {
    expect(
      getErrorInfo(Object.assign(new Error("Duplicate tool name: read"), { code: "TOOL_REGISTRY_INVALID" })),
    ).toEqual({ code: "TOOL_REGISTRY_INVALID", message: "Duplicate tool name: read" });
  });

  it("retries network failures and transient stream codes, but not bugs or quota exhaustion", () => {
    for (const error of [
      new APIConnectionError({}),
      new TypeError("Failed to fetch"),
      new Error("request ended without sending any events"),
      new APIError(undefined, { code: "server_error" }, "Temporary failure", undefined),
    ]) {
      expect(isRecoverableStreamError(error)).toBe(true);
    }
    for (const error of [
      new TypeError("Cannot read properties of undefined"),
      new DOMException("Stopped", "AbortError"),
      new RateLimitError(429, { code: "insufficient_quota" }, "Quota exceeded", new Headers()),
    ]) {
      expect(isRecoverableStreamError(error)).toBe(false);
    }
  });
});

describe("retry delays", () => {
  const error = (headers: Record<string, string>) => new RateLimitError(429, {}, "Slow down", new Headers(headers));
  it("reads numeric seconds, HTTP dates, and millisecond headers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
    expect(getRetryAfterMs(error({ "retry-after": "2.5" }))).toBe(2500);
    expect(getRetryAfterMs(error({ "retry-after": "Sun, 06 Sep 2026 12:00:03 GMT" }))).toBe(3000);
    expect(getRetryAfterMs(error({ "retry-after-ms": "125" }))).toBe(125);
    expect(getRetryAfterMs(error({ "retry-after": "-1" }))).toBe(0);
  });

  it("bounds huge provider delays without overflowing timers", async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const pending = waitBeforeStreamRetry(0, error({ "retry-after": "999999999" })).then(done);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels backoff promptly and cleans up its timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitBeforeStreamRetry(0, error({ "retry-after": "30" }), controller.signal);
    controller.abort();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    await waitBeforeStreamRetry(0, error({}), controller.signal);
    expect(vi.getTimerCount()).toBe(0);
  });
});
