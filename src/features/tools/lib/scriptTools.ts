import { convertSchemaToJsonSchema, parseWithStandardSchema } from "@tanstack/ai";
import { outputText } from "@/shared/lib/messages";
import type { MessageError, Tool, ToolContext } from "@/shared/types/chat";

export function createScriptToolbox(parent: ToolContext, signal: AbortSignal) {
  const elicit = parent.elicit?.bind(parent);
  const tools = new Map<string, Tool>();
  for (const tool of parent.scriptTools ?? []) {
    if (!tool.script || tool.subagent || tool.name === "execute_script") continue;
    if (tool.needsApproval && tool.script === true) continue;
    tools.set(tool.name, tool);
  }
  let pending = Promise.resolve();

  return {
    list: () =>
      [...tools.values()].map(({ name, description, inputSchema, script }) => ({
        name,
        description,
        parameters: convertSchemaToJsonSchema(inputSchema),
        ...(typeof script === "object" && script.outputSchema && { outputSchema: script.outputSchema }),
      })),
    async call(name: string, input: unknown): Promise<unknown> {
      signal.throwIfAborted();
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool "${name}" is unavailable to this script. Use tools.list() for available tools.`);
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("Tool arguments must be an object");
      const args = parseWithStandardSchema<Record<string, unknown>>(tool.inputSchema, input);

      // One live elicitation can be displayed at a time. Keep calls, including
      // writes submitted by Promise.all or asyncio.gather, in submission order.
      const result = pending.then(async () => {
        signal.throwIfAborted();
        let error: MessageError | undefined;
        const context: ToolContext = {
          model: parent.model,
          chatId: parent.chatId,
          runId: parent.runId,
          invocationContext: parent.invocationContext,
          signal,
          // Live approval uses the target tool's own name and actual arguments.
          // A nested call cannot resume the outer TanStack tool interrupt.
          elicit:
            elicit &&
            ((request, options) =>
              elicit(request, {
                ...options,
                signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal,
              })),
          onElicitationComplete: parent.onElicitationComplete?.bind(parent),
          setMeta: (meta) => {
            if (!signal.aborted && meta.mcpProgress) parent.setMeta?.({ mcpProgress: meta.mcpProgress });
          },
          setError: (next) => {
            error = next;
          },
        };
        const value =
          typeof tool.script === "object"
            ? await tool.script.execute(args, context)
            : outputText(
                await tool.execute(args, {
                  context,
                  abortSignal: signal,
                  toolCallId: crypto.randomUUID(),
                  emitCustomEvent() {},
                }),
              );
        signal.throwIfAborted();
        if (error) throw new Error(error.message);
        return value;
      });
      pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
