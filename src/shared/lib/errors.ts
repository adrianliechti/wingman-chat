/**
 * Error classification and messaging utilities for OpenAI SDK errors
 */
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ContentFilterFinishReasonError,
  InternalServerError,
  LengthFinishReasonError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "openai/error";

export interface ErrorInfo {
  code: string;
  message: string;
}

/**
 * Check if error is from OpenAI SDK
 */
export function isOpenAIError(error: unknown): error is APIError {
  return error instanceof APIError;
}

/**
 * Check whether an error represents a user-initiated cancellation
 * (either the OpenAI SDK's abort error or a native DOMException AbortError).
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof APIUserAbortError) return true;
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  // Fallback: some environments throw plain Error with name "AbortError"
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Extract retry-after delay in milliseconds from an OpenAI SDK error.
 *
 * Supports (in priority order):
 *  1. `Retry-After` header as integer or float seconds (e.g. "30", "2.5")
 *  2. `Retry-After` header as HTTP-date (RFC 7231 §7.1.3)
 *  3. `retry-after-ms` header as milliseconds (Azure OpenAI extension)
 */
export function getRetryAfterMs(error: unknown): number | undefined {
  if (!isOpenAIError(error)) return undefined;

  const retryAfter = error.headers?.get("retry-after")?.trim();
  if (retryAfter) {
    // Numeric seconds (integer or float)
    const seconds = Number.parseFloat(retryAfter);
    if (!Number.isNaN(seconds) && Number.isFinite(seconds) && /^-?\d+(\.\d+)?$/.test(retryAfter)) {
      return Math.max(0, Math.round(seconds * 1000));
    }

    // HTTP-date
    const date = new Date(retryAfter);
    if (!Number.isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - Date.now());
    }
  }

  // Azure OpenAI non-standard millisecond header
  const retryAfterMs = error.headers?.get("retry-after-ms")?.trim();
  if (retryAfterMs) {
    const ms = Number.parseFloat(retryAfterMs);
    if (!Number.isNaN(ms) && Number.isFinite(ms)) {
      return Math.max(0, Math.round(ms));
    }
  }

  return undefined;
}

/**
 * Best-effort extraction of the server-provided error message from an APIError.
 * OpenAI's SDK puts the parsed response body in `error.error`, which is the
 * user-facing text. Falls back to `error.message` (which may include the
 * raw HTTP status prefix).
 */
function getServerMessage(error: APIError): string | undefined {
  const body = error.error as { message?: unknown } | undefined;
  const msg = body?.message;
  if (typeof msg === "string" && msg.trim()) return msg;
  return error.message || undefined;
}

/**
 * Convert error to user-friendly code and message
 */
export function getErrorInfo(error: unknown): ErrorInfo {
  // User-initiated cancellation (from AbortController or SDK runner.abort())
  if (isAbortError(error)) {
    return {
      code: "CANCELLED",
      message: "Request was cancelled.",
    };
  }

  // Streaming finish-reason errors thrown by the SDK helpers
  if (error instanceof ContentFilterFinishReasonError) {
    return {
      code: "CONTENT_FILTERED",
      message: "The response was blocked by the content filter.",
    };
  }
  if (error instanceof LengthFinishReasonError) {
    return {
      code: "CONTEXT_EXHAUSTED",
      message: "The response was truncated because the maximum token limit was reached.",
    };
  }

  // OpenAI SDK errors
  if (isOpenAIError(error)) {
    // Network-level failures (no HTTP response received)
    if (error instanceof APIConnectionTimeoutError) {
      return {
        code: "NETWORK_ERROR",
        message: "The request timed out. Please check your connection and try again.",
      };
    }
    if (error instanceof APIConnectionError) {
      return {
        code: "NETWORK_ERROR",
        message: "Could not reach the server. Please check your internet connection and try again.",
      };
    }

    if (error instanceof RateLimitError) {
      const retryAfterMs = getRetryAfterMs(error);
      const retryAfterMsg = retryAfterMs
        ? ` Please wait ${Math.ceil(retryAfterMs / 1000)} seconds before trying again.`
        : " Please wait a moment before trying again.";
      return {
        code: "RATE_LIMIT_ERROR",
        message: `Rate limit exceeded.${retryAfterMsg}`,
      };
    }

    if (error instanceof InternalServerError) {
      return {
        code: "SERVER_ERROR",
        message: `Server error (${error.status ?? "5xx"}). Please try again in a moment.`,
      };
    }

    if (error instanceof AuthenticationError) {
      return {
        code: "AUTH_ERROR",
        message: "Authentication failed. Please check your API key or credentials.",
      };
    }

    if (error instanceof PermissionDeniedError) {
      return {
        code: "AUTH_ERROR",
        message: "Access denied. You may not have permission to use this model.",
      };
    }

    if (error instanceof NotFoundError) {
      return {
        code: "NOT_FOUND_ERROR",
        message: "The requested model or resource was not found.",
      };
    }

    if (error instanceof BadRequestError) {
      // Distinguish specific 400 sub-cases via OpenAI error code/type
      const apiCode = error.code ?? "";
      const apiType = error.type ?? "";
      const serverMsg = getServerMessage(error);

      if (apiCode === "context_length_exceeded" || apiCode === "string_above_max_length") {
        return {
          code: "CONTEXT_EXHAUSTED",
          message: serverMsg || "The conversation is too long for the model's context window.",
        };
      }

      if (apiCode === "content_policy_violation" || apiType === "content_filter") {
        return {
          code: "CONTENT_FILTERED",
          message: serverMsg || "The request was blocked by the content policy.",
        };
      }

      return {
        code: "CLIENT_ERROR",
        message: serverMsg || `Request error (${error.status}). Please check your input.`,
      };
    }

    return {
      code: "API_ERROR",
      message: getServerMessage(error) || `API error (${error.status ?? "unknown"}). Please try again.`,
    };
  }

  // Non-SDK errors: native network failures from fetch()
  if (error instanceof TypeError) {
    return {
      code: "NETWORK_ERROR",
      message: "Network connection failed. Please check your internet connection and try again.",
    };
  }

  // Fallback string matching for anything else
  const errorString = error?.toString() || "";

  if (errorString.includes("timeout") || errorString.includes("network")) {
    return {
      code: "NETWORK_ERROR",
      message: "Network connection failed. Please check your internet connection and try again.",
    };
  }

  return {
    code: "COMPLETION_ERROR",
    message: "An unexpected error occurred while generating the response.",
  };
}
