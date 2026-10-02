import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { Client } from "@/shared/lib/client";
import { run, streamRun, AgentMessageMetadata } from "@/shared/lib/agent";
import { ChatClient } from "@tanstack/ai-client";
import type { UIMessage } from "@tanstack/ai";
import { fromAIMessages, toAIMessages } from "@/shared/lib/aiMessages";
import { response, textItem, callItem, finished, sse } from "@/shared/lib/test-support/ai";
import { chatSession } from "@/shared/lib/test-support/chatSession";
import type { Message, Tool } from "@/shared/types/chat";
import { historyForRetry } from "@/features/chat/lib/chatHistory";

const prompt: Message[] = [{ role: "user", content: [{ type: "text", text: "Go" }] }];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: new URL("http://localhost") });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("parses final-answer JSON when a response also contains commentary", async () => {
  fetchMock.mockResolvedValueOnce(
    finished(
      response([
        { ...textItem('{"answer":"Working"}'), id: "commentary", phase: "commentary" },
        { ...textItem('{"answer":"Done"}'), id: "final", phase: "final_answer" },
      ]),
    ),
  );
  expect(await new Client().parse("model", "", "Go", z.object({ answer: z.string() }), "review")).toEqual({
    answer: "Done",
  });
});

it("uses the authoritative completed text when deltas stop before the final response", async () => {
  fetchMock.mockResolvedValueOnce(
    sse([
      { type: "response.created", response: response([], { status: "in_progress" }) },
      { type: "response.output_item.added", output_index: 0, item: { ...textItem(""), content: [] } },
      { type: "response.output_text.delta", item_id: "msg_test", output_index: 0, content_index: 0, delta: "Hello" },
      { type: "response.completed", response: response([textItem("Hello world")]) },
    ]),
  );
  const result = await run(new Client(), "model", "", prompt, []);
  expect(result.status).toBe("completed");
  expect(result.messages.at(-1)?.content).toEqual([{ type: "text", text: "Hello world" }]);
});

it("preserves both visible signed reasoning and its separate summary on replay", async () => {
  fetchMock.mockResolvedValueOnce(finished(response([textItem("Done")])));
  const history: Message[] = [
    ...prompt,
    {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          id: "rs_review",
          text: "Signed visible reasoning",
          summary: "Short summary",
          encryptedContent: "signature",
          model: "model",
        },
        { type: "text", text: "First answer" },
      ],
    },
    ...prompt,
  ];
  const result = await run(new Client(), "model", "", history, []);
  expect(result.status).toBe("completed");
  const item = JSON.parse(fetchMock.mock.calls[0][1].body).input.find(
    (item: { type: string }) => item.type === "reasoning",
  );
  expect(item).toMatchObject({ content: [{ type: "reasoning_text", text: "Signed visible reasoning" }] });
  expect(fromAIMessages(toAIMessages(history))[1].content[0]).toMatchObject({
    text: "Signed visible reasoning",
    summary: "Short summary",
  });
});

it.each([
  ["invalid_encrypted_content", "Encrypted content could not be verified"],
  ["invalid_request_error", "messages.7: The final block in an assistant message cannot be `thinking`."],
])("retries rejected reasoning (%s) once and clears it from saved history", async (code, message) => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code, message },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    )
    .mockResolvedValueOnce(finished(response([textItem("Recovered")])));
  const history: Message[] = [
    ...prompt,
    {
      role: "assistant",
      content: [
        { type: "reasoning", id: "rs_review", text: "Plan", encryptedContent: "old-key", model: "model" },
        { type: "text", text: "First answer" },
      ],
    },
    ...prompt,
  ];
  const result = await run(new Client(), "model", "", history, []);
  expect(result.status).toBe("completed");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    JSON.parse(fetchMock.mock.calls[1][1].body).input.some((part: { type: string }) => part.type === "reasoning"),
  ).toBe(false);
  expect(result.messages[1].content[0]).toMatchObject({ type: "reasoning", text: "Plan" });
  expect(JSON.stringify(result.messages)).not.toContain("old-key");
  expect(history[1].content[0]).toMatchObject({ encryptedContent: "old-key" });
  fetchMock.mockResolvedValueOnce(finished(response([textItem("Continued")])));
  const restored = JSON.parse(JSON.stringify(result.messages));
  expect((await run(new Client(), "model", "", [...restored, ...prompt], [])).status).toBe("completed");
  expect(JSON.stringify(JSON.parse(fetchMock.mock.calls[2][1].body).input)).not.toContain("old-key");
});

it.each([false, true])("excludes unfinished reasoning on retry with pending tool call: %s", async (pendingCall) => {
  fetchMock.mockResolvedValueOnce(finished(response([textItem("Recovered")])));
  const execute = vi.fn<Tool["function"]>(async () => [{ type: "text", text: "Already read" }]);
  const messages: Message[] = [
    ...prompt,
    {
      role: "assistant",
      content: [
        { type: "reasoning", id: "rs_tool", text: "Read the skill", encryptedContent: "tool-key", model: "model" },
        { type: "tool_call", id: "read-skill", name: "read", arguments: "{}" },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          id: "read-skill",
          name: "read",
          arguments: "{}",
          result: [{ type: "text", text: "Skill instructions" }],
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          id: "rs_unfinished",
          text: "Preparing the artifact",
          encryptedContent: "unfinished-key",
          model: "model",
        },
        ...(pendingCall
          ? [{ type: "tool_call" as const, id: "unfinished-call", name: "read", arguments: "{}", incomplete: true }]
          : []),
      ],
    },
    { role: "assistant", content: [], error: { code: "TIMEOUT", message: "Model response timed out after 60s" } },
  ];
  const before = JSON.stringify(messages);
  const result = await run(new Client(), "model", "", historyForRetry(messages)!, [
    { name: "read", parameters: { type: "object", properties: {} }, function: execute },
  ]);
  expect(result.status).toBe("completed");
  const input = JSON.parse(fetchMock.mock.calls[0][1].body).input;
  expect(input.filter((part: { type: string }) => part.type === "reasoning")).toMatchObject([
    { id: "rs_tool", encrypted_content: "tool-key" },
  ]);
  expect(input).toContainEqual(expect.objectContaining({ type: "function_call", call_id: "read-skill" }));
  expect(input).toContainEqual({ type: "function_call_output", call_id: "read-skill", output: "Skill instructions" });
  expect(JSON.stringify(input)).not.toMatch(/unfinished-key|unfinished-call|rs_unfinished/);
  expect(execute).not.toHaveBeenCalled();
  expect(JSON.stringify(messages)).toBe(before);
  expect(result.messages.flatMap((message) => message.content)).toContainEqual(
    expect.objectContaining({ type: "reasoning", text: "Preparing the artifact" }),
  );
});

it("retains reasoning model identity at the live chat persistence boundary", async () => {
  fetchMock.mockResolvedValueOnce(
    finished(
      response([
        { type: "reasoning", id: "rs_review", encrypted_content: "signature", summary: [], status: "completed" },
        textItem("Done"),
      ]),
    ),
  );
  const session = chatSession(new Client(), []);
  try {
    await session.ai.sendMessage("Go");
    const stored = session.metadata.read(session.ai.getMessages());
    const reasoning = stored.flatMap((message) => message.content).find((part) => part.type === "reasoning");
    expect(reasoning).toMatchObject({ encryptedContent: "signature", model: "model" });
  } finally {
    session.ai.dispose();
  }
});

it("does not replay model-a ciphertext to model-b after switching a live chat", async () => {
  fetchMock
    .mockResolvedValueOnce(
      finished(
        response(
          [
            {
              type: "reasoning",
              id: "rs_review",
              encrypted_content: "model-a-signature",
              summary: [],
              status: "completed",
            },
            textItem("First answer"),
          ],
          { model: "model-a" },
        ),
      ),
    )
    .mockResolvedValueOnce(finished(response([textItem("Second answer")], { model: "model-b" })));
  const metadata = new AgentMessageMetadata();
  const client = new Client();
  let model = "model-a";
  const ai = new ChatClient({
    threadId: "review-chat",
    connection: {
      connect: (messages, _data, signal, ctx) =>
        streamRun(client, model, "", metadata.read(messages as UIMessage[]), [], {
          metadata,
          options: { signal },
          runId: ctx?.runId,
          threadId: ctx?.threadId,
        }),
    },
  });
  try {
    await ai.sendMessage("First");
    model = "model-b";
    await ai.sendMessage("Second");
    const input = JSON.parse(fetchMock.mock.calls[1][1].body).input;
    expect(input.filter((item: { type: string }) => item.type === "reasoning")).toEqual([]);
  } finally {
    ai.dispose();
  }
});

function mockOpenStream() {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const emit = (event: object) => body.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  fetchMock.mockImplementationOnce(
    (_url, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            body = controller;
            emit({ type: "response.created", response: response([], { status: "in_progress" }) });
            init.signal?.addEventListener("abort", () => body.error(init.signal?.reason), { once: true });
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  return { emit, close: () => body.close() };
}

it.each(["response.reasoning_text.delta", "response.reasoning_summary_text.delta", "response.output_text.delta"])(
  "streams %s past an hour with gaps longer than ten minutes",
  async (type) => {
    vi.useFakeTimers();
    const stream = mockOpenStream();
    let settled = false;
    const request = run(new Client(), "model", "", prompt, []).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
      expect(settled).toBe(false);
      stream.emit({
        type,
        item_id: "item_test",
        output_index: 0,
        content_index: 0,
        delta: "Still working. ",
        response: response([], { status: "in_progress" }),
      });
      await vi.advanceTimersByTimeAsync(0);
    }
    stream.emit({ type: "response.completed", response: response([textItem("Done")]) });
    stream.close();
    const result = await request;
    expect(result.status).toBe("completed");
    expect(result.messages.at(-1)?.content).toContainEqual({ type: "text", text: "Done" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each(["complete", "stop"])("allows a silent response to %s after an hour", async (end) => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const stream = mockOpenStream();
  let settled = false;
  const request = run(new Client(), "model", "", prompt, [], { options: { signal: controller.signal } }).finally(() => {
    settled = true;
  });
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  expect(settled).toBe(false);
  if (end === "complete") {
    stream.emit({ type: "response.completed", response: response([textItem("Done")]) });
    stream.close();
  } else controller.abort();
  const result = await request;
  expect(result.status).toBe(end === "complete" ? "completed" : "aborted");
  if (end === "complete") expect(result.messages.at(-1)?.content).toEqual([{ type: "text", text: "Done" }]);
  else expect(result.error).toMatchObject({ code: "CANCELLED" });
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the native timeout and retries while waiting for response headers", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  );
  const request = run(new Client(), "model", "", prompt, []);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 5_000);
  expect((await request).status).toBe("failed");
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it("retains selected artifact line locations in the model request", async () => {
  fetchMock.mockResolvedValueOnce(finished(response([textItem("Done")])));
  await run(
    new Client(),
    "model",
    "",
    [
      {
        role: "user",
        content: [
          { type: "text", text: "Edit the second occurrence" },
          { type: "artifact_selection", path: "/notes.md", text: "Repeated phrase", startLine: 100, endLine: 102 },
        ],
      },
    ],
    [],
  );
  const input = JSON.parse(fetchMock.mock.calls[0][1].body).input;
  expect(JSON.stringify(input)).toContain("lines 100-102");
  expect(input[0].content[0].text).toBe(
    "Edit the second occurrence\nSelected text in /notes.md (lines 100-102):\n```\nRepeated phrase\n```",
  );
});

it("keeps schema validation and optional/null semantics when selecting final JSON", async () => {
  const schema = z.object({ optional: z.string().optional(), nullable: z.string().nullable() });
  fetchMock.mockResolvedValueOnce(
    finished(
      response([
        { ...textItem("Checking the result"), id: "commentary", phase: "commentary" },
        { ...textItem('{"optional":null,"nullable":null}'), id: "final", phase: "final_answer" },
      ]),
    ),
  );
  expect(await new Client().parse("model", "", "Go", schema, "fixture")).toEqual({ nullable: null });
});

it("does not accept valid commentary JSON when the final schema answer is invalid", async () => {
  fetchMock.mockResolvedValueOnce(
    finished(
      response([
        { ...textItem('{"answer":"Commentary"}'), id: "commentary", phase: "commentary" },
        { ...textItem("Invalid final JSON"), id: "final", phase: "final_answer" },
      ]),
    ),
  );
  await expect(new Client().parse("model", "", "Go", z.object({ answer: z.string() }), "fixture")).rejects.toThrow(
    /structured output/,
  );
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("replaces earlier text in the live native client and its persisted history", async () => {
  fetchMock.mockResolvedValueOnce(
    sse([
      { type: "response.created", response: response([], { status: "in_progress" }) },
      { type: "response.output_item.added", output_index: 0, item: { ...textItem(""), content: [] } },
      { type: "response.output_text.delta", item_id: "msg_test", output_index: 0, content_index: 0, delta: "Draft" },
      { type: "response.completed", response: response([{ ...textItem("Final answer"), phase: "final_answer" }]) },
    ]),
  );
  const session = chatSession(new Client(), []);
  try {
    await session.ai.sendMessage("Go");
    expect(session.ai.getMessages().at(-1)?.parts).toMatchObject([{ type: "text", content: "Final answer" }]);
    const restored = fromAIMessages(session.store.value!.messages);
    expect(restored.at(-1)?.content).toEqual([{ type: "text", text: "Final answer", phase: "final_answer" }]);
    fetchMock.mockResolvedValueOnce(finished(response([textItem("Next")])));
    await session.ai.sendMessage("Continue");
    const input = JSON.parse(fetchMock.mock.calls[1][1].body).input;
    expect(input).toContainEqual(expect.objectContaining({ content: "Final answer", phase: "final_answer" }));
    expect(JSON.stringify(input)).not.toContain("Draft");
  } finally {
    session.ai.dispose();
  }
});

it("retains rich results and executes a tool once when completed text rewrites a tool turn", async () => {
  fetchMock
    .mockResolvedValueOnce(
      sse([
        { type: "response.created", response: response([], { status: "in_progress" }) },
        { type: "response.output_text.delta", item_id: "msg_test", output_index: 0, content_index: 0, delta: "Draft" },
        { type: "response.completed", response: response([textItem("Checked"), callItem()]) },
      ]),
    )
    .mockResolvedValueOnce(finished(response([textItem("Done")])));
  const execute = vi.fn<Tool["function"]>(async (_input, ctx) => {
    ctx?.setMeta?.({ file: "/notes.md" });
    return [{ type: "image", data: "data:image/png;base64,AQ==" }];
  });
  const result = await run(new Client(), "model", "", prompt, [
    { name: "write", parameters: { type: "object", properties: {} }, function: execute },
  ]);
  expect(result.status).toBe("completed");
  expect(execute).toHaveBeenCalledOnce();
  expect(result.messages.flatMap((message) => message.content)).toMatchObject([
    { type: "text", text: "Go" },
    { type: "text", text: "Checked" },
    { type: "tool_call", id: "call_test" },
    {
      type: "tool_result",
      meta: { file: "/notes.md" },
      result: [{ type: "image", data: "data:image/png;base64,AQ==" }],
    },
    { type: "text", text: "Done" },
  ]);
});

it("replays live signed text and summary for the same deployment alias after persistence", async () => {
  const item = {
    type: "reasoning",
    id: "rs_review",
    encrypted_content: "signature",
    status: "completed",
    content: [{ type: "reasoning_text", text: "Signed text" }],
    summary: [{ type: "summary_text", text: "Summary" }],
  };
  fetchMock.mockResolvedValueOnce(finished(response([item, textItem("Done")], { model: "resolved-provider-model" })));
  const session = chatSession(new Client(), []);
  try {
    await session.ai.sendMessage("Go");
    const restored = JSON.parse(JSON.stringify(session.metadata.read(session.ai.getMessages())));
    expect(restored.at(-1).content[0]).toMatchObject({
      type: "reasoning",
      id: "rs_review",
      text: "Signed text",
      summary: "Summary",
      encryptedContent: "signature",
      model: "model",
    });
    fetchMock.mockResolvedValueOnce(finished(response([textItem("Next")])));
    await run(new Client(), "model", "", [...restored, ...prompt], [], { prepareMessages: (messages) => messages });
    const input = JSON.parse(fetchMock.mock.calls[1][1].body).input;
    expect(input.find((part: { type: string }) => part.type === "reasoning")).toMatchObject({
      type: item.type,
      id: item.id,
      encrypted_content: item.encrypted_content,
      content: item.content,
      summary: item.summary,
    });
  } finally {
    session.ai.dispose();
  }
});

it("streams requested reasoning summaries and preserves them after chat persistence", async () => {
  const summary = "Checking the calculation";
  const item = {
    type: "reasoning",
    id: "rs_summary",
    encrypted_content: "signature",
    summary: [{ type: "summary_text", text: summary }],
    status: "completed",
  };
  fetchMock.mockResolvedValueOnce(
    sse([
      { type: "response.created", response: response([], { status: "in_progress" }) },
      { type: "response.output_item.added", output_index: 0, item: { ...item, encrypted_content: null, summary: [] } },
      {
        type: "response.reasoning_summary_text.delta",
        item_id: item.id,
        output_index: 0,
        summary_index: 0,
        delta: summary,
      },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.output_text.delta", item_id: "msg_test", output_index: 1, content_index: 0, delta: "Done" },
      { type: "response.completed", response: response([item, textItem("Done")]) },
    ]),
  );
  const session = chatSession(new Client(), []);
  const streamed: string[] = [];
  session.ai.updateOptions({
    onChunk: (chunk) => {
      if (chunk.type === "REASONING_MESSAGE_CONTENT") streamed.push(chunk.delta);
    },
  });
  try {
    await session.ai.sendMessage("Go");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual({ summary: "auto" });
    expect(streamed).toContain(summary);
    expect(session.store.value).toBeDefined();
    const restored = fromAIMessages(session.store.value!.messages);
    expect(restored.flatMap((message) => message.content)).toContainEqual(
      expect.objectContaining({ type: "reasoning", summary, encryptedContent: "signature", model: "model" }),
    );
  } finally {
    session.ai.dispose();
  }
});

it("keeps visible reasoning deltas separate from summary when completion omits visible content", async () => {
  const item = {
    type: "reasoning",
    id: "rs_review",
    encrypted_content: "signature",
    summary: [{ type: "summary_text", text: "Summary" }],
  };
  fetchMock.mockResolvedValueOnce(
    sse([
      { type: "response.created", response: response([], { status: "in_progress" }) },
      { type: "response.output_item.added", output_index: 0, item: { ...item, encrypted_content: null, summary: [] } },
      {
        type: "response.reasoning_text.delta",
        item_id: "rs_review",
        output_index: 0,
        content_index: 0,
        delta: "Signed text",
      },
      {
        type: "response.reasoning_summary_text.delta",
        item_id: "rs_review",
        output_index: 0,
        summary_index: 0,
        delta: "Summary",
      },
      { type: "response.output_text.delta", item_id: "msg_test", output_index: 1, content_index: 0, delta: "Done" },
      { type: "response.completed", response: response([item, textItem("Done")]) },
    ]),
  );
  const result = await run(new Client(), "model", "", prompt, []);
  expect(result.status).toBe("completed");
  expect(result.messages.at(-1)?.content[0]).toMatchObject({
    text: "Signed text",
    summary: "Summary",
    encryptedContent: "signature",
    model: "model",
  });
});

it.each([
  ["invalid_encrypted_content", "Bad input", 2],
  ["invalid_request_error", "Bad input", 1],
  ["invalid_request_error", "messages.7: The final block in an assistant message cannot be `thinking`.", 2],
])("bounds retries for a rejected request with code %s", async (code, message, attempts) => {
  fetchMock.mockImplementation(async () => Response.json({ error: { code, message } }, { status: 400 }));
  const result = await run(
    new Client(),
    "model",
    "",
    [
      ...prompt,
      {
        role: "assistant",
        content: [
          { type: "reasoning", id: "rs_old", text: "Plan", encryptedContent: "old-key", model: "model" },
          { type: "text", text: "First answer" },
        ],
      },
      ...prompt,
    ],
    [],
  );
  expect(result.status).toBe("failed");
  expect(fetchMock).toHaveBeenCalledTimes(attempts);
});

it.each([
  ["invalid_encrypted_content", "Encrypted content could not be verified"],
  ["invalid_request_error", "messages.7: The final block in an assistant message cannot be `thinking`."],
])("does not retry a reasoning error (%s) after response text has arrived", async (code, message) => {
  fetchMock.mockResolvedValueOnce(
    sse([
      { type: "response.created", response: response([], { status: "in_progress" }) },
      { type: "response.output_text.delta", item_id: "msg_test", output_index: 0, content_index: 0, delta: "Partial" },
      { type: "error", code, message },
    ]),
  );
  const result = await run(
    new Client(),
    "model",
    "",
    [
      ...prompt,
      {
        role: "assistant",
        content: [
          { type: "reasoning", id: "rs_old", text: "Plan", encryptedContent: "old-key", model: "model" },
          { type: "text", text: "First answer" },
        ],
      },
      ...prompt,
    ],
    [],
  );
  expect(result.status).toBe("failed");
  expect(result.messages.at(-1)?.content).toEqual([{ type: "text", text: "Partial" }]);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("pairs deduplicated reasoning with the text and signature from the same original item", async () => {
  fetchMock.mockResolvedValueOnce(finished(response([textItem("Done")])));
  await run(
    new Client(),
    "model",
    "",
    [
      ...prompt,
      ...["First", "Second"].map((text): Message => ({
        role: "assistant",
        content: [
          {
            type: "reasoning",
            id: "rs_duplicate",
            text,
            summary: `${text} summary`,
            encryptedContent: `${text} signature`,
            model: "model",
          },
          { type: "text", text: `${text} answer` },
        ],
      })),
      ...prompt,
    ],
    [],
  );
  const input = JSON.parse(fetchMock.mock.calls[0][1].body).input;
  expect(input.filter((part: { type: string }) => part.type === "reasoning")).toEqual([
    {
      type: "reasoning",
      id: "rs_duplicate",
      encrypted_content: "First signature",
      content: [{ type: "reasoning_text", text: "First" }],
      summary: [{ type: "summary_text", text: "First summary" }],
    },
  ]);
});

it("releases the model-call deadline after a successful response", async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(finished(response([textItem("Done")])));
  expect((await run(new Client(), "model", "", prompt, [])).status).toBe("completed");
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(600_001);
  expect(fetchMock).toHaveBeenCalledOnce();
});
