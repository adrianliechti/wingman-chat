import { parsePartialJSON } from "@tanstack/ai";

/** Partial arguments are only for display; TanStack validates executed tool input. */
export function tryParseToolArguments(raw: string | undefined | null): Record<string, unknown> | null {
  const value: unknown = parsePartialJSON(raw ?? "");
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
