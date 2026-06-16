import { tryParseToolArguments } from "@/shared/lib/toolArguments";
import { getToolDisplayName } from "@/shared/lib/utils";
import type {
  Content,
  Tool,
  ToolDisplayBlock,
  ToolDisplayIcon,
  ToolDisplayState,
  ToolProvider,
} from "@/shared/types/chat";
import { getToolCallPreview } from "./chatMessageUtils";

export interface ResolvedToolHeader {
  Icon?: ToolDisplayIcon;
  label: string;
  mono: boolean;
  /** Short preview shown beside the label, or null when there's nothing useful / it's suppressed. */
  preview: string | null;
}

/** Find a tool definition by name across the active providers. */
export function findTool(providers: readonly ToolProvider[], name: string | undefined): Tool | undefined {
  if (!name) return undefined;
  for (const provider of providers) {
    const tool = provider.tools.find((t) => t.name === name);
    if (tool) return tool;
  }
  return undefined;
}

/**
 * Collapsed/running header for a tool call: the tool's own `display.header` if it
 * has one, otherwise a generic name-cased label plus an argument preview.
 */
export function resolveToolHeader(
  tool: Tool | undefined,
  name: string,
  rawArgs: string | undefined,
  state: ToolDisplayState,
): ResolvedToolHeader {
  const h = tool?.display?.header?.(tryParseToolArguments(rawArgs ?? ""), state);
  return {
    Icon: h?.icon,
    label: h?.label ?? tool?.title ?? getToolDisplayName(name),
    mono: h?.mono ?? false,
    preview: h?.suppressPreview ? null : (h?.preview ?? (rawArgs ? getToolCallPreview(name, rawArgs) : null)),
  };
}

/** Expanded input blocks: the tool's `display.input`, else a best-effort arguments block. */
export function resolveToolInput(tool: Tool | undefined, rawArgs: string | undefined): ToolDisplayBlock[] {
  const input = tool?.display?.input;
  return input ? input(tryParseToolArguments(rawArgs ?? "")) : defaultInputBlocks(rawArgs);
}

/**
 * Expanded success output block: the tool's `display.output`, else a best-effort
 * block of the textual result. Media (images/audio/files) renders separately, so
 * a pure-media result yields null.
 */
export function resolveToolOutput(tool: Tool | undefined, result: Content[]): ToolDisplayBlock | null {
  const output = tool?.display?.output;
  return output ? output(result) : defaultOutputBlock(result);
}

// ── Best-effort default formatting ──────────────────────────────────────────

/** Replace data: URLs with a short placeholder so the raw view stays readable. */
function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      const match = value.match(/^data:([^;,]+)/);
      return `[${match ? match[1] : "data"} data]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = sanitize(val);
    return out;
  }
  return value;
}

/** Pretty-printed JSON if the text parses, otherwise the raw text. */
function jsonOrText(text: string): { code: string; language: string } {
  try {
    return { code: JSON.stringify(sanitize(JSON.parse(text)), null, 2), language: "json" };
  } catch {
    return { code: text, language: "text" };
  }
}

function defaultInputBlocks(rawArgs: string | undefined): ToolDisplayBlock[] {
  const trimmed = rawArgs?.trim();
  if (!trimmed) return [];
  return [{ ...jsonOrText(trimmed), name: "Arguments" }];
}

function defaultOutputBlock(result: Content[]): ToolDisplayBlock | null {
  const texts = result.filter((c): c is Extract<Content, { type: "text" }> => c.type === "text").map((c) => c.text);
  if (texts.length === 0) return null; // pure media — rendered separately
  return { ...jsonOrText(texts.join("\n")), name: "Result" };
}
