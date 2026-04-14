/**
 * Source access tools for notebooks.
 * Provides list and read tools so the LLM can selectively access source content.
 */

import type { TextContent, Tool } from "@/shared/types/chat";
import type { NotebookSource } from "../types/notebook";

const MAX_READ_CHARS = 15000;

function textResult(text: string): TextContent[] {
  return [{ type: "text" as const, text }];
}

function errorResult(message: string): TextContent[] {
  return [{ type: "text" as const, text: JSON.stringify({ error: message }) }];
}

function createListTool(sources: NotebookSource[]): Tool {
  return {
    name: "source_list",
    description: "List all available research sources with their ID, name, type, and size.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    function: async () => {
      if (sources.length === 0) {
        return textResult("# No sources available");
      }

      const lines = sources.map((s) => {
        const chars = s.content.length;
        const typeLabel = s.type === "web" ? "web" : "file";
        return `- [${s.id}] ${s.name} (${typeLabel}, ${chars}C)`;
      });

      return textResult([`# ${sources.length} sources`, ...lines].join("\n"));
    },
  };
}

function createReadTool(sources: NotebookSource[]): Tool {
  return {
    name: "source_read",
    description: "Read the content of a specific research source by its ID.",
    parameters: {
      type: "object",
      properties: {
        source_id: {
          type: "string",
          description: "The ID of the source to read (from source_list output).",
        },
      },
      required: ["source_id"],
    },
    function: async (args: Record<string, unknown>) => {
      const sourceId = args.source_id as string;

      if (!sourceId) {
        return errorResult("source_id is required");
      }

      const source = sources.find((s) => s.id === sourceId);

      if (!source) {
        const available = sources.map((s) => `${s.id} (${s.name})`).join(", ");
        return errorResult(`Source "${sourceId}" not found. Available: ${available}`);
      }

      let content = source.content;
      let truncated = false;

      if (content.length > MAX_READ_CHARS) {
        content = content.slice(0, MAX_READ_CHARS);
        truncated = true;
      }

      const header = `# ${source.name}${truncated ? ` [truncated at ${MAX_READ_CHARS} chars, total: ${source.content.length}C]` : ""}`;

      return textResult(`${header}\n\n${content}`);
    },
  };
}

/**
 * Create source access tools for the LLM.
 */
export function createSourceTools(sources: NotebookSource[]): Tool[] {
  return [createListTool(sources), createReadTool(sources)];
}
