import { CONTEXT_OVERFLOW_CODE } from "@tanstack/ai";

/** Presentation of native TanStack/provider errors; retry policy belongs to the adapter. */
export interface ErrorInfo {
  code: string;
  message: string;
}

type ProviderError = {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
  type?: string;
  error?: unknown;
  rawEvent?: unknown;
  retryAfterMs?: unknown;
  metadata?: { tanstack?: { retryAfterMs?: unknown } };
};
function detail(error: unknown): ProviderError {
  if (!error || typeof error !== "object") return {};
  const value = error as ProviderError;
  const body = value.rawEvent ?? value.error;
  return body && typeof body === "object"
    ? { ...value, name: value.name, message: value.message, ...(body as ProviderError) }
    : value;
}
export function isAbortError(error: unknown): boolean {
  const value = detail(error);
  return value.name === "AbortError" || value.name === "APIUserAbortError" || value.code === "CANCELLED";
}
export function isContextOverflowError(error: unknown): boolean {
  const value = detail(error);
  if (
    [CONTEXT_OVERFLOW_CODE, "context_length_exceeded", "string_above_max_length", "CONTEXT_EXHAUSTED"].includes(
      value.code ?? "",
    )
  )
    return true;
  if (value.status && ![400, 413].includes(value.status)) return false;
  return /context (length|window)|maximum context|too many tokens|(?:prompt|input|request) (?:is )?too long/i.test(
    value.message ?? "",
  );
}

/** A rejected input can be retried without its opaque reasoning, before any response content arrives. */
export function isReasoningReplayError(error: unknown): boolean {
  const value = detail(error);
  if (value.status !== undefined && ![400, 413, 422].includes(value.status)) return false;
  if (value.code === "invalid_encrypted_content") return true;
  const message = (value.message ?? "").toLowerCase().replaceAll("`", "");
  return (
    message.includes("invalid_encrypted_content") ||
    message.includes("encrypted content could not be verified") ||
    (message.includes("reasoning") && message.includes("required following item")) ||
    (message.includes("thinking") &&
      (message.includes("invalid signature") ||
        message.includes("signature verification failed") ||
        message.includes("the final block in an assistant message cannot be thinking")))
  );
}
export function getErrorInfo(error: unknown): ErrorInfo {
  if (isAbortError(error)) return { code: "CANCELLED", message: "Request was cancelled." };
  const value = detail(error);
  const original = error as ProviderError | null | undefined;
  const message = value.message ?? "";
  if (isContextOverflowError(error))
    return {
      code: "CONTEXT_EXHAUSTED",
      message: message || "The conversation is too long for the model's context window.",
    };
  if (
    /max_output_tokens|output.*truncat|(?:reached|exceeded).*output.*limit|output.*limit.*(?:reached|exceeded)/i.test(
      message,
    ) ||
    value.code === "length"
  )
    return {
      code: "OUTPUT_TRUNCATED",
      message: "The response was truncated because the maximum token limit was reached.",
    };
  if (/content_filter|content_policy_violation/.test(`${value.code} ${value.type} ${message}`))
    return { code: "CONTENT_FILTERED", message: "The response was blocked by the content filter." };
  if (value.status === 429 || ["429", "rate_limit_exceeded", "RATE_LIMIT_ERROR"].includes(value.code ?? "")) {
    const delay = value.metadata?.tanstack?.retryAfterMs ?? value.retryAfterMs;
    const seconds =
      typeof delay === "number" && Number.isFinite(delay) && delay >= 0 ? Math.ceil(delay / 1000) : undefined;
    return {
      code: "RATE_LIMIT_ERROR",
      message:
        seconds !== undefined
          ? `Rate limit exceeded. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`
          : original?.code === "RATE_LIMIT_ERROR" && original.message
            ? original.message
            : "Rate limit exceeded. Please wait a moment before trying again.",
    };
  }
  if ((value.status ?? 0) >= 500 || ["server_error", "overloaded_error"].includes(value.code ?? ""))
    return { code: "SERVER_ERROR", message: "Server error. Please try again in a moment." };
  if (value.status === 401 || value.code === "invalid_api_key")
    return { code: "AUTH_ERROR", message: "Authentication failed. Please check your credentials." };
  if (value.status === 403)
    return { code: "AUTH_ERROR", message: "Access denied. You may not have permission to use this model." };
  if (value.status === 404 || value.code === "model_not_found")
    return { code: "NOT_FOUND_ERROR", message: "The requested model or resource was not found." };
  if (
    value.code === "TIMEOUT" ||
    value.code === "REQUEST_TIMEOUT" ||
    value.name === "TimeoutError" ||
    value.name === "APIConnectionTimeoutError" ||
    /\btimed out\b/i.test(message)
  )
    return {
      code: "TIMEOUT",
      message: /timed out/i.test(message) ? message : "Request timed out. Please try again.",
    };
  if (/network|connection|failed to fetch|fetch failed|load failed/i.test(message))
    return { code: "NETWORK_ERROR", message: "Network connection failed. Please check your connection and try again." };
  if (value.code && /^[A-Z_]+$/.test(value.code)) return { code: value.code, message };
  if (value.status || value.code)
    return {
      code: value.status === 400 ? "CLIENT_ERROR" : "API_ERROR",
      message: message || "The model request failed.",
    };
  return {
    code: "COMPLETION_ERROR",
    message: message || "An unexpected error occurred while generating the response.",
  };
}
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}
