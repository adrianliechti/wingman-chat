import { createFileTools, type WritableFileSource } from "@/shared/lib/file-tools";
import type { Tool, ToolContext } from "@/shared/types/chat";
import { isMemoryPath, memoryPath, memoryRevision, boundMemoryText } from "./memoryDocument";
import type { MemoryManager } from "./memoryManager";
import { memoryFileHeader, memoryOperationPaths } from "./memoryFileDisplay";

const OPTIONS = {
  namespace: "artifacts",
  spaceName: "workspace (persistent notes under /.memory/)",
  maxReadChars: 6000,
  maxReadLines: 200,
  maxEditBytes: 8192,
  defaultGrepLimit: 20,
  maxGrepLineChars: 200,
  maxPathResults: 50,
};
const unavailable = async (): Promise<never> => {
  throw new Error("This file space is unavailable.");
};
const EMPTY: WritableFileSource = {
  list: unavailable,
  read: unavailable,
  write: unavailable,
  writeBatch: unavailable,
  move: unavailable,
  remove: unavailable,
};

/** Routes the existing file operation schemas; never introduces memory CRUD tools. */
export function mountMemoryFiles(tools: Tool[], manager?: MemoryManager): Tool[] {
  const definitions = createFileTools(EMPTY, OPTIONS);
  const byName = new Map(definitions.map((tool) => [tool.name, tool]));
  const original = new Map(tools.map((tool) => [tool.name, tool]));
  const observations = new Map<string, Map<string, string | undefined>>();
  const candidates = [...tools, ...(manager ? definitions.filter((tool) => !original.has(tool.name)) : [])];
  return candidates.map((tool) => {
    if (!byName.has(tool.name)) return tool;
    const operation = tool.name.slice("artifacts_".length);
    return {
      ...tool,
      display: {
        ...tool.display,
        header: (args, state) => memoryFileHeader(tool.name, args, state) ?? tool.display?.header?.(args, state) ?? {},
      },
      description: `${tool.description ?? ""}${manager ? " Persistent agent notes are mounted at /.memory/; scope searches there explicitly. index.md is generated and read-only. Use file tools for this mount; code runtimes contain only conversation artifacts." : " /.memory/ is reserved and unavailable."}`,
      function: async (args, context) => {
        const paths = memoryOperationPaths(operation, args);
        const mounted = paths.some(isMemoryPath);
        if (!mounted)
          return (
            original.get(tool.name)?.function(args, context) ?? [
              { type: "text", text: JSON.stringify({ error: "Only /.memory/ is available." }) },
            ]
          );
        const fail = (message: string) => {
          context?.setError?.({ code: "MEMORY_OPERATION_FAILED", message });
          return [{ type: "text" as const, text: JSON.stringify({ error: message }) }];
        };
        if (!manager) return fail("Memory is disabled or no agent is selected.");
        if (!paths.every(isMemoryPath))
          return fail("A file operation cannot span memory and conversation artifacts. Use separate operations.");
        const mutation = !["read", "grep", "glob"].includes(operation);
        if (mutation && context?.invocationContext?.branch)
          return fail("Subagents have read-only memory access. Return proposed changes to the parent.");
        const session = `${context?.chatId ?? "local"}/${context?.invocationContext?.branch ?? "root"}`;
        const observed = observations.get(session) ?? new Map<string, string | undefined>();
        observations.set(session, observed);
        const source =
          context?.chatId && context.runId
            ? {
                resource: `wingman://chats/${context.chatId}/runs/${context.runId}`,
              }
            : undefined;
        try {
          const nextObserved = new Map(observed);
          const result = await manager.transaction(
            async (memory) => {
              const files = memory.source;
              if (operation === "read") {
                const read = files.read.bind(files);
                files.read = async (path) => {
                  const file = await read(path);
                  nextObserved.set(memoryPath(path), file ? await memoryRevision(file.content) : undefined);
                  return file;
                };
              }
              const definition = createFileTools(files, OPTIONS).find((item) => item.name === tool.name)!;
              // Generic file tools publish artifact metadata; memory is not a deliverable.
              const memoryContext: ToolContext | undefined = context
                ? { ...context, setMeta: undefined, updateMeta: undefined }
                : undefined;
              const output = await definition.function(args, memoryContext);
              context?.signal?.throwIfAborted();
              const failure = output.find(
                (part) =>
                  part.type === "text" &&
                  (() => {
                    try {
                      return !!JSON.parse(part.text).error;
                    } catch {
                      return false;
                    }
                  })(),
              );
              // Failed writes must not grant a fresh revision observation.
              if (failure?.type === "text") throw new Error(JSON.parse(failure.text).error);
              if (mutation) {
                for (const path of paths) {
                  const relative = memoryPath(path as string);
                  const content = memory.files.get(relative);
                  nextObserved.set(relative, content === undefined ? undefined : await memoryRevision(content));
                }
              }
              return output;
            },
            { writable: mutation, observed: mutation ? observed : undefined, source, requireEnabled: true },
          );
          observations.set(session, nextObserved);
          // The complete output has a hard ceiling even when grep asks for all results.
          return result.map((part) =>
            part.type === "text" ? { ...part, text: boundMemoryText(part.text, 8192) } : part,
          );
        } catch (error) {
          return fail(error instanceof Error ? error.message : "Memory operation failed.");
        }
      },
    };
  });
}
