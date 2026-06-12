import { jsonrepair } from "jsonrepair";

/**
 * Thrown when tool-call arguments can't be parsed even after a repair pass.
 * Carries the raw string so callers can craft a model-facing error.
 */
export class ToolArgumentsParseError extends Error {
  /** The raw (un-repairable) arguments string, retained for logging. */
  readonly raw: string;

  constructor(raw: string, reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = "ToolArgumentsParseError";
    this.raw = raw;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  // Tool arguments are always a JSON object. A bare array/number/string means
  // the model emitted something malformed enough that repair "succeeded" on the
  // wrong shape — treat that as a non-object and let callers see empty args.
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Parse LLM tool-call arguments. Models frequently mis-escape quotes and
 * backslashes when packing source code into a JSON string field, producing
 * arguments that `JSON.parse` rejects (e.g. `{"code":"print("hi")"}`). We try a
 * strict parse first, then fall back to `jsonrepair`, which fixes the common
 * unescaped-quote / stray-newline / bad-escape cases. Strict parse always wins
 * when it succeeds — repair is only a fallback, so well-formed args are never
 * touched.
 *
 * @throws {ToolArgumentsParseError} when even the repaired string won't parse.
 */
export function parseToolArguments(raw: string | undefined | null): Record<string, unknown> {
  const text = (raw ?? "").trim();
  if (!text) return {};

  try {
    return asObject(JSON.parse(text));
  } catch {
    // Fall through to the repair attempt.
  }

  try {
    return asObject(JSON.parse(jsonrepair(text)));
  } catch (reason) {
    throw new ToolArgumentsParseError(text, reason);
  }
}

/**
 * Lenient variant for UI/render paths that should never throw — returns `null`
 * instead of raising. Use this when parsing partial (mid-stream) arguments or
 * when a parse failure should just hide a preview rather than surface an error.
 */
export function tryParseToolArguments(raw: string | undefined | null): Record<string, unknown> | null {
  try {
    return parseToolArguments(raw);
  } catch {
    return null;
  }
}
