import type { ContentPart, TextOptions, ToolCallPart, UIMessage } from "@tanstack/ai";
import type { Client } from "../client";
import { assistantMessage, text, textSegments, userMessage, type TextMetadata } from "@/shared/lib/messages";

/** Test provider: the real TanStack engine still owns validation and tool execution. */
export function testClient(
  complete: (options: TextOptions<Record<string, unknown>>, onStream: (text: string) => void) => Promise<UIMessage>,
): Client {
  return {
    chatModelOptions: () => ({}),
    textAdapter: (model: string) => ({
      kind: "text",
      name: "test",
      model,
      async *chatStream(options: TextOptions<Record<string, unknown>>) {
        const id = crypto.randomUUID();
        const pending: { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }[] = [];
        let notify: (() => void) | undefined;
        let settled = false;
        let streamedText = "";
        const result = complete(options, (text) => {
          pending.push({ type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: text.slice(streamedText.length) });
          streamedText = text;
          notify?.();
        }).finally(() => {
          settled = true;
          notify?.();
        });
        void result.catch(() => {});
        yield { type: "RUN_STARTED", runId: id, threadId: "test" };
        yield { type: "TEXT_MESSAGE_START", role: "assistant", messageId: id };
        while (!settled || pending.length) {
          while (pending.length) yield pending.shift()!;
          if (!settled)
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
        }
        const response = await result;
        const finalText = response.parts.flatMap((part) => (part.type === "text" ? [part.content] : [])).join("");
        if (streamedText) {
          if (finalText.startsWith(streamedText) && finalText.length > streamedText.length)
            yield { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: finalText.slice(streamedText.length) };
        }
        for (const part of response.parts) {
          if (part.type === "text" && !streamedText)
            yield {
              type: "TEXT_MESSAGE_CONTENT",
              messageId: id,
              delta: part.content,
              metadata: { textSegments: textSegments(response) },
            };
          if (part.type === "tool-call") {
            yield { type: "TOOL_CALL_START", toolCallId: part.id, toolCallName: part.name, parentMessageId: id };
            yield { type: "TOOL_CALL_ARGS", toolCallId: part.id, delta: part.arguments };
            if (part.state === "input-streaming") {
              yield { type: "RUN_ERROR", message: "max_output_tokens", code: "incomplete" };
              return;
            }
            yield { type: "TOOL_CALL_END", toolCallId: part.id };
          }
        }
        yield { type: "TEXT_MESSAGE_END", messageId: id };
        yield {
          type: "RUN_FINISHED",
          runId: id,
          threadId: "test",
          finishReason: response.parts.some((part) => part.type === "tool-call") ? "tool_calls" : "stop",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      },
    }),
  } as unknown as Client;
}

export function response(output: object[] = [], fields: Record<string, unknown> = {}) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 0,
    model: "model",
    status: "completed",
    output,
    error: null,
    incomplete_details: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 2 },
      output_tokens_details: { reasoning_tokens: 1 },
    },
    ...fields,
  };
}
export const textItem = (text: string) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});
export const callItem = (args = "{}", name = "write", id = "call_test") => ({
  id: `fc_${id}`,
  type: "function_call",
  call_id: id,
  name,
  arguments: args,
  status: "completed",
});
export function sse(events: object[]) {
  return new Response(
    events.map((event, sequence_number) => `data: ${JSON.stringify({ sequence_number, ...event })}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
export function finished(final: ReturnType<typeof response>) {
  const events: object[] = [
    {
      type: "response.created",
      response: response([], { ...final, output: [], status: "in_progress", usage: undefined }),
    },
  ];
  final.output.forEach((item, output_index) => {
    const output = item as { type: string; id: string; content?: { text: string }[] };
    events.push({ type: "response.output_item.added", output_index, item });
    if (output.type === "message") {
      output.content?.forEach((part, content_index) =>
        events.push({
          type: "response.output_text.delta",
          item_id: output.id,
          output_index,
          content_index,
          delta: part.text,
        }),
      );
    }
    events.push({ type: "response.output_item.done", output_index, item });
  });
  events.push({ type: `response.${final.status}`, response: final });
  return sse(events);
}

// ── Native transcript fixtures ────────────────────────────────────────────

/** A user turn with one text part. */
export const user = (content: string, init?: Parameters<typeof userMessage>[1]) => userMessage(content, init);
/** An assistant turn with one text part. */
export const assistant = (content: string, init?: Parameters<typeof assistantMessage>[1]) =>
  assistantMessage(content, init);

/** A finished tool call as the fake adapter emits it. */
export function toolCall(id: string, name: string, args: object | string = {}): ToolCallPart {
  return {
    type: "tool-call",
    id,
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
    state: "input-complete",
  };
}

/** An assistant turn that only calls tools. */
export const calls = (...tools: Array<[string, string, (object | string)?]>) =>
  assistantMessage(tools.map(([id, name, args]) => toolCall(id, name, args)));

/** A tool's text output. */
export const output = (content: string): ContentPart[] => [text(content)];

/** Internal feedback the next model turn reads; the UI never shows it. */
export function feedbackMessage(content: string, source: NonNullable<TextMetadata["source"]>): UIMessage {
  return userMessage([text(content, { source })], { metadata: { kind: "runtime_feedback" } });
}

/** An assistant turn that calls tools, as a provider would produce it. */
export function toolCallMessage(
  calls: { id: string; name: string; arguments: string; incomplete?: boolean }[],
  init?: Partial<Omit<UIMessage, "role" | "parts">>,
): UIMessage {
  return assistantMessage(
    calls.map((call) => ({
      type: "tool-call",
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      state: call.incomplete ? "input-streaming" : "input-complete",
    })),
    init,
  );
}
