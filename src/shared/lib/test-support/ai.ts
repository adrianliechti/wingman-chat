import type { Client } from "../client";
import type { Content, Message } from "@/shared/types/chat";
import type { TextOptions } from "@tanstack/ai";

/** Test provider: the real TanStack engine still owns validation and tool execution. */
export function testClient(
  complete: (options: TextOptions<Record<string, unknown>>, onStream: (content: Content[]) => void) => Promise<Message>,
): Client {
  return {
    chatModelOptions: () => ({}),
    textAdapter: () => ({
      kind: "text",
      name: "test",
      model: "test",
      async *chatStream(options: TextOptions<Record<string, unknown>>) {
        const id = crypto.randomUUID();
        const pending: { type: "MESSAGES_SNAPSHOT"; messages: { id: string; role: "assistant"; content: string }[] }[] =
          [];
        let notify: (() => void) | undefined;
        let settled = false;
        let streamedText = "";
        const result = complete(options, (content) => {
          const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
          pending.push({ type: "MESSAGES_SNAPSHOT", messages: [{ id, role: "assistant", content: text }] });
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
        if (streamedText)
          yield {
            type: "MESSAGES_SNAPSHOT",
            messages: [
              {
                id,
                role: "assistant",
                content: response.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
              },
            ],
          };
        for (const part of response.content) {
          if (part.type === "text" && !streamedText)
            yield {
              type: "TEXT_MESSAGE_CONTENT",
              messageId: id,
              delta: part.text,
              metadata: {
                wingmanTextSegments: response.content.flatMap((part) =>
                  part.type === "text" ? [{ content: part.text, phase: part.phase }] : [],
                ),
              },
            };
          if (part.type === "tool_call") {
            yield { type: "TOOL_CALL_START", toolCallId: part.id, toolCallName: part.name, parentMessageId: id };
            yield { type: "TOOL_CALL_ARGS", toolCallId: part.id, delta: part.arguments };
            if (part.incomplete) {
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
          finishReason: response.content.some((part) => part.type === "tool_call") ? "tool_calls" : "stop",
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
