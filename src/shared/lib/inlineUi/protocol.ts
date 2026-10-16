import { parseMarkdown, type BlockNode } from "@tanstack/markdown";
import {
  AgentToRendererMessageSchema,
  DataModel,
  type AgentToRendererMessage,
  validateRecursionAndPaths,
} from "@a2ui/web_core/v1_0";

export const UI_FENCE_LANGUAGES = new Set(["ui", "a2ui", "wingman-ui", "intelligent-ui", "iui"]);
export const MAX_UI_SOURCE = 500_000;
export type UiMessage = AgentToRendererMessage;
export interface UiBlock {
  key: string;
  source: string;
  streaming?: boolean;
}
export interface ParsedMessages {
  messages: UiMessage[];
  pending: boolean;
  error?: string;
}

const pointerValidator = new DataModel();
function validatePaths(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if ((key === "@path" || key === "path") && typeof item === "string") pointerValidator.get(item);
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(`Forbidden data key: ${key}`);
    validatePaths(item);
  }
}

/** Only complete JSON messages are applied. An unfinished streaming message never invents values. */
export function parseMessages(source: string, streaming = false): ParsedMessages {
  if (source.length > MAX_UI_SOURCE) return { messages: [], pending: false, error: "Interface exceeds 500 KB" };
  const text = source.trim();
  if (!text) return { messages: [], pending: streaming, ...(!streaming && { error: "Expected A2UI messages" }) };
  let raw: unknown[];
  let pending = false;
  try {
    const parsed: unknown = JSON.parse(text);
    raw = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // JSONL and a streaming JSON array share the same complete-object scanner.
    raw = [];
    const brackets: string[] = [];
    let start = -1,
      quoted = false,
      escaped = false,
      end = 0;
    const array = text.startsWith("[");
    for (let i = array ? 1 : 0; i < text.length; i++) {
      const char = text[i];
      if (start === -1) {
        if (/\s/.test(char) || (array && char === ",")) continue;
        if (array && char === "]" && i === text.length - 1) continue;
        if (char !== "{") return { messages: [], pending: false, error: "Expected strict A2UI JSON or JSONL" };
        if (raw.length && !array && !text.slice(end, i).includes("\n"))
          return { messages: [], pending: false, error: "JSONL messages must be separated by a newline" };
        if (array && text.slice(end || 1, i).trim() !== (raw.length ? "," : ""))
          return { messages: [], pending: false, error: "Invalid JSON array separator" };
        start = i;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{" || char === "[") brackets.push(char);
      else if (char === "}" || char === "]") {
        const expected = brackets.at(-1) === "{" ? "}" : "]";
        if (char !== expected)
          return {
            messages: [],
            pending: false,
            error: `Invalid JSON message: expected '${expected}' but found '${char}' at position ${i}`,
          };
        brackets.pop();
        if (brackets.length === 0) {
          try {
            raw.push(JSON.parse(text.slice(start, i + 1)));
          } catch {
            return { messages: [], pending: false, error: "Invalid JSON message" };
          }
          start = -1;
          end = i + 1;
        }
      }
    }
    pending = start !== -1 || (array && !text.endsWith("]"));
    if (pending && !streaming) return { messages: [], pending: false, error: "Incomplete A2UI message" };
    // A complete but invalid JSON array must not be silently repaired by the scanner.
    if (array && !pending) return { messages: [], pending: false, error: "Invalid JSON array" };
  }
  if (raw.length > 500) return { messages: [], pending: false, error: "Too many A2UI messages" };
  const messages: UiMessage[] = [];
  try {
    for (const message of raw) {
      validateRecursionAndPaths(message);
      validatePaths(message);
      const parsed = AgentToRendererMessageSchema.parse(message);
      if ("updateDataModel" in parsed && !("value" in parsed.updateDataModel))
        throw new Error("updateDataModel requires value; use null to delete");
      messages.push(parsed);
    }
    return { messages, pending };
  } catch (error) {
    return { messages: [], pending: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Traverse the same Markdown tree as the renderer, including nested/open fences. */
export function extractUiFences(markdown: string): string[] {
  const result: string[] = [];
  const visit = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      if (node.type === "code" && UI_FENCE_LANGUAGES.has(node.lang?.toLowerCase() ?? "")) result.push(node.value);
      else if (node.type === "list" || node.type === "footnotes") for (const item of node.items) visit(item.children);
      else if (node.type === "blockquote" || node.type === "callout" || node.type === "component") visit(node.children);
    }
  };
  visit(parseMarkdown(markdown).children);
  return result;
}
