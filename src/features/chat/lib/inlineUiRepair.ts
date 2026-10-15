import { EventType, type AGUIEvent } from "@ag-ui/core";
import { uiMessagesToWire, type UIMessage } from "@tanstack/ai";
import { streamRun, type AgentRunResult, type StreamRunHooks } from "@/shared/lib/agent";
import type { Client } from "@/shared/lib/client";
import { isIntermediateToolTurn } from "@/shared/lib/aiStream";
import { textParts } from "@/shared/lib/messages";
import { injectRequestContext } from "@/shared/lib/requestContext";
import { extractUiFences, parseMessages, type UiBlock } from "@/shared/lib/inlineUi/protocol";
import { InlineUiRuntime } from "@/shared/lib/inlineUi/runtime";
import type { Tool } from "@/shared/types/chat";

const MAX_REPAIRS = 2;

/** Replay prior surfaces for context, but only repair errors in the newly generated reply. */
function replyErrors(messages: UIMessage[], index: number): string[] {
  // Ordinary text replies need no UI validation or replay of the conversation.
  if (!textParts(messages[index]).some((part) => extractUiFences(part.content).length)) return [];
  const blocks: UiBlock[] = [];
  const replyKeys = new Set<string>();
  const surfaces = new Set<string>();
  messages.forEach((message, messageIndex) => {
    if (message.role !== "assistant") return;
    textParts(message).forEach((part, partIndex) => {
      extractUiFences(part.content).forEach((source, blockIndex) => {
        const key = `${messageIndex}/${partIndex}/${blockIndex}`;
        blocks.push({ key, source });
        if (messageIndex !== index) return;
        replyKeys.add(key);
        for (const message of parseMessages(source).messages) {
          if ("createSurface" in message) surfaces.add(message.createSurface.surfaceId);
          if ("updateComponents" in message) surfaces.add(message.updateComponents.surfaceId);
          if ("updateDataModel" in message) surfaces.add(message.updateDataModel.surfaceId);
        }
      });
    });
  });
  const runtime = new InlineUiRuntime();
  try {
    runtime.sync(blocks);
    return [...runtime.errors]
      .filter(([key]) => replyKeys.has(key) || surfaces.has(key) || key === "session")
      .slice(-5)
      .map(([, error]) => error);
  } finally {
    runtime.dispose();
  }
}

/** Repair generated UI within the same chat run, without replaying tools or saving diagnostic prompts. */
export async function* streamChatWithUiRepair(
  client: Client,
  model: string,
  instructions: string,
  messages: UIMessage[],
  tools: Tool[],
  hooks: StreamRunHooks,
): AsyncGenerator<AGUIEvent> {
  let history = messages;
  let feedback = "";
  const runId = hooks.runId ?? crypto.randomUUID();
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    let result: AgentRunResult | undefined;
    let terminal: AGUIEvent | undefined;
    for await (const chunk of streamRun(client, model, instructions, history, attempt ? [] : tools, {
      ...hooks,
      runId,
      ...(attempt
        ? {
            resume: undefined,
            middleware: [
              ...(hooks.middleware ?? []),
              {
                name: "inline-ui-repair",
                onConfig: (ctx) => (ctx.phase === "init" || ctx.phase === "beforeModel" ? { tools: [] } : undefined),
              },
            ],
          }
        : {}),
      prepareMessages: async (messages, signal) => {
        const prepared = hooks.prepareMessages ? await hooks.prepareMessages(messages, signal) : messages;
        return feedback ? injectRequestContext(prepared, feedback) : prepared;
      },
      onComplete: (value) => {
        result = value;
      },
    })) {
      const root = !("subagentRunId" in chunk) || !chunk.subagentRunId;
      if (chunk.type === EventType.RUN_FINISHED && root && !isIntermediateToolTurn(chunk)) terminal = chunk;
      else if (!(attempt && chunk.type === EventType.RUN_STARTED && root)) yield chunk;
    }
    if (!result) throw new Error("Chat run did not finish");
    const index = result.messages.length - 1;
    const reply = result.messages[index];
    const errors =
      result.status === "completed" &&
      reply?.role === "assistant" &&
      !history.some((message) => message.id === reply.id)
        ? replyErrors(result.messages, index)
        : [];
    if (!errors.length || attempt === MAX_REPAIRS) {
      await hooks.onComplete?.(result);
      if (terminal) yield terminal;
      return;
    }
    feedback =
      "The previous reply's inline UI failed validation. Regenerate the complete reply, preserving its intent and correcting the UI JSON. " +
      "Replace the failed reply; do not emit a partial update to its failed createSurface. Keep component and surface IDs stable. " +
      "Use the documented component catalogs and property types. Tools are unavailable during this repair.\n" +
      `Validation errors:\n${errors.join("\n").slice(0, 6000)}\nFailed reply:\n${textParts(reply)
        .map((part) => part.content)
        .join("\n")}`;
    history = result.messages.slice(0, index);
    // Replace the failed reply in the client before streaming its corrected replacement.
    yield { type: EventType.MESSAGES_SNAPSHOT, messages: uiMessagesToWire(history) };
  }
}
