import { parsePartialJSON } from "@tanstack/ai";

/** Canonical single-path selector, with a fallback for callers and chats saved before the rename. */
export function toolArgumentPath(args: Record<string, unknown> | null | undefined): string | undefined {
  const value = args?.path !== undefined ? args.path : args?.file_path;
  return typeof value === "string" ? value : undefined;
}

/** Partial arguments are only for display; TanStack validates executed tool input. */
export function tryParseToolArguments(raw: string | undefined | null): Record<string, unknown> | null {
  const value: unknown = parsePartialJSON(raw ?? "");
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
