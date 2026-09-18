import type {
  Response as ModelResponse,
  ResponseOutputItem,
  ResponseReasoningItem,
} from "openai/resources/responses/responses";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "./client";
import * as errors from "./errors";
import { run } from "./agent";
import type { Content, Message, Tool } from "../types/chat";

function response(output: ResponseOutputItem[] = [], fields: Partial<ModelResponse> = {}): ModelResponse {
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
  } as ModelResponse;
}

const textItem = (text: string): ResponseOutputItem => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});
const callItem = (
  args = "{}",
  status: "completed" | "incomplete" | "in_progress" = "completed",
): Extract<ResponseOutputItem, { type: "function_call" }> => ({
  id: "fc_test",
  type: "function_call",
  call_id: "call_test",
  name: "write",
  arguments: args,
  status,
});
const reasoningItem = (id: string, status: ResponseReasoningItem["status"] = "completed"): ResponseReasoningItem => ({
  id,
  type: "reasoning",
  summary: [{ type: "summary_text", text: "Plan" }],
  encrypted_content: `encrypted-${id}`,
  status,
});

function sse(events: object[]): Response {
  const data = events
    .map((event, sequence_number) => `data: ${JSON.stringify({ sequence_number, ...event })}\n\n`)
    .join("");
  return new Response(data, { headers: { "content-type": "text/event-stream" } });
}

function finished(final: ModelResponse): Response {
  return sse([
    { type: "response.created", response: response([], { status: "in_progress", usage: undefined }) },
    { type: `response.${final.status}`, response: final },
  ]);
}

const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Go" }] }];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: new URL("http://localhost") });
  vi.spyOn(errors, "waitBeforeStreamRetry").mockResolvedValue();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("raw request lifetime", () => {
  it("forwards cancellation through segmentation and embedding requests", async () => {
    for (const operation of ["segment", "embed"]) {
      const controller = new AbortController();
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce((_url, options: RequestInit) => {
        signal = options.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) =>
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }),
        );
      });
      const client = new Client();
      const request =
        operation === "segment"
          ? client.segmentText("Source", { signal: controller.signal })
          : client.embedText("model", "Source", { signal: controller.signal });
      const rejection = expect(request).rejects.toMatchObject({ name: expect.stringMatching(/Abort/) });
      await vi.waitFor(() => expect(signal).toBeDefined());
      controller.abort();
      await rejection;
      expect(signal!.aborted).toBe(true);
    }
  });

  it("returns the resolved embedding model so default-model changes can be detected", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ model: "resolved", data: [{ embedding: [0.5, 1] }] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await new Client().embedText("", "Source")).toEqual({ model: "resolved", vector: [0.5, 1] });
  });

  it.each([
    { data: [] },
    { model: "resolved", data: [{ embedding: [] }] },
    { model: "resolved", data: [{ embedding: [1e100] }] },
    { model: "resolved", data: [{ embedding: ["1"] }] },
    { data: [{ embedding: [1, 2] }] },
  ])("rejects malformed or unidentified embeddings: %j", async (body) => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
    );
    await expect(new Client().embedText("", "Source")).rejects.toThrow(/embedding service/);
  });

  it.each([{}, [null], [42], [{ text: 5 }], [], ["  "]].map((body) => ({ body })))(
    "rejects unusable segmentation responses: $body",
    async ({ body }) => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
      await expect(new Client().segmentText("Source")).rejects.toThrow(/segmentation service/);
    },
  );

  it("accepts string and object segments while preserving passage whitespace", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([" First ", { text: "Second\nline" }, " "])));
    expect(await new Client().segmentText("Source")).toEqual([" First ", "Second\nline"]);
  });
  it("reads text, JSON, and binary results and releases each deadline", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response("Grüße", { headers: { "content-type": "text/plain" } }));
    expect(await new Client().translate("de", "Greetings")).toBe("Grüsse");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ flagged: true, categories: [] })));
    expect(await new Client().guard("model", "Text")).toEqual({ flagged: true, categories: [] });
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } }));
    const rendered = await new Client().generateImage("model", "Image");
    expect(rendered.type).toBe("image/png");
    expect(new Uint8Array(await rendered.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    expect(vi.getTimerCount()).toBe(0);
  });

  function stalledBody(status = 200) {
    fetchMock.mockImplementationOnce(
      async (_url: URL, options: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              options.signal?.addEventListener("abort", () => controller.error(options.signal?.reason), { once: true });
            },
          }),
          { status },
        ),
    );
  }

  it.each([200, 503])("keeps the timeout active while reading a stalled %s response body", async (status) => {
    vi.useFakeTimers();
    stalledBody(status);
    const request = new Client().scrape("model", "https://example.com");
    const settled = vi.fn();
    void request.then(settled, settled);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(settled).toHaveBeenCalledOnce();
    await expect(request).rejects.toThrow("/api/v1/extract timed out after 90s");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains caller cancellation until the body is consumed in the signal fallback", async () => {
    vi.spyOn(AbortSignal, "any").mockImplementation(() => {
      throw new Error("Unavailable");
    });
    stalledBody();
    const controller = new AbortController();
    const request = new Client().scrape("model", "https://example.com", { signal: controller.signal });
    const settled = vi.fn();
    void request.then(settled, settled);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settled).toHaveBeenCalledOnce();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not fetch an already cancelled raw request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new Client().scrape("model", "https://example.com", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Responses transport (real SDK, synthetic HTTP/SSE)", () => {
  const stalledStream = (_url: URL, options: RequestInit) =>
    new Response(
      new ReadableStream({
        start(controller) {
          const created = { type: "response.created", response: response([], { status: "in_progress" }) };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(created)}\n\n`));
          options.signal?.addEventListener("abort", () => controller.error(options.signal?.reason), { once: true });
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

  it("times out a stalled stream body and recovers within the existing retry bound", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(stalledStream);
    fetchMock.mockResolvedValueOnce(finished(response([textItem("Recovered after timeout")])));
    const request = new Client().complete("model", "", prompt, []);
    const settled = vi.fn();
    void request.then(settled, settled);
    await vi.advanceTimersByTimeAsync(600_001);
    expect(settled).toHaveBeenCalledOnce();
    expect((await request).content).toEqual([{ type: "text", text: "Recovered after timeout" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a timeout after three stalled attempts without leaving timers behind", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(stalledStream);
    const request = new Client().complete("model", "", prompt, []);
    const settled = vi.fn();
    void request.then(settled, settled);
    await vi.advanceTimersByTimeAsync(1_800_010);
    expect(settled).toHaveBeenCalledOnce();
    await expect(request).rejects.toSatisfy((error: unknown) =>
      errors.getErrorInfo(error).message.includes("timed out"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stalled stream immediately and clears its deadline without retrying", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(stalledStream);
    const controller = new AbortController();
    const request = new Client().complete("model", "", prompt, [], undefined, { signal: controller.signal });
    const outcome = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await outcome;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("replays portable history with named files, summaries, and only paired tool calls", async () => {
    fetchMock.mockResolvedValueOnce(finished(response([textItem("OK")])));
    const history: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "summary", text: "Prior work" },
          { type: "reasoning", id: "private", text: "Provider-specific reasoning" },
          { type: "text", text: "Before tool" },
          { type: "tool_call", id: "paired", name: "read", arguments: "{}" },
          { type: "text", text: "After tool" },
          { type: "tool_call", id: "orphan", name: "read", arguments: "{}" },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            id: "paired",
            name: "read",
            arguments: "{}",
            result: [
              { type: "text", text: "Evidence" },
              { type: "image", data: "data:image/png;base64,result" },
            ],
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "file", name: "report.pdf", data: "data:application/pdf;base64,fixture" },
          { type: "artifact_ref", path: "/report.pdf", revision: "v1" },
          { type: "image", data: "data:application/octet-stream;base64,unsupported" },
        ],
      },
    ];
    const original = structuredClone(history);
    await new Client().complete("different-provider", "", history, []);
    const input = JSON.parse(fetchMock.mock.calls[0][1].body).input;
    expect(JSON.stringify(input)).not.toMatch(/Provider-specific|orphan|base64,result|base64,unsupported/);
    expect(input.at(-1).content[0]).toEqual({
      type: "input_file",
      filename: "report.pdf",
      file_data: "data:application/pdf;base64,fixture",
    });
    expect(input.map((item: { type: string }) => item.type)).toEqual([
      "message",
      "message",
      "function_call",
      "message",
      "function_call_output",
      "message",
    ]);
    expect(history).toEqual(original);
  });

  it("requests encrypted reasoning and replays it between the tool calls of one turn", async () => {
    const reasoning = {
      id: "rs_1",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Plan" }],
      encrypted_content: "enc-1",
      status: "completed",
    } as ResponseOutputItem;
    fetchMock
      .mockResolvedValueOnce(finished(response([reasoning, callItem()])))
      .mockResolvedValueOnce(finished(response([textItem("Done")])));
    const write = vi.fn(async () => [{ type: "text" as const, text: "OK" }]);
    const tools: Tool[] = [{ name: "write", parameters: { type: "object", properties: {} }, function: write }];
    const result = await run(new Client(), "model", "Be brief", prompt, tools);
    expect(result.status).toBe("completed");
    const requests = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(requests[0].include).toEqual(["reasoning.encrypted_content"]);
    expect(requests[1].input.map((item: { type: string }) => item.type)).toEqual([
      "message",
      "reasoning",
      "function_call",
      "function_call_output",
    ]);
    expect(requests[1].input[1]).toEqual({
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "Plan" }],
      encrypted_content: "enc-1",
    });
    // Keep the payload available to providers that use reasoning from earlier turns.
    expect(result.messages[1].content[0]).toMatchObject({
      type: "reasoning",
      id: "rs_1",
      text: "",
      summary: "Plan",
      encryptedContent: "enc-1",
      model: "model",
    });
  });

  it("does not replay reasoning produced for another model", async () => {
    const reasoning = { id: "rs_1", type: "reasoning", summary: [], encrypted_content: "enc-1" } as ResponseOutputItem;
    fetchMock.mockResolvedValueOnce(finished(response([reasoning, callItem()])));
    const first = await new Client().complete("model-a", "", prompt, []);
    expect(first.content[0]).toMatchObject({ type: "reasoning", encryptedContent: "enc-1", model: "model-a" });
    const history: Message[] = [
      ...prompt,
      first,
      {
        role: "user",
        content: [{ type: "tool_result", id: "call_test", name: "write", arguments: "{}", result: [] }],
      },
    ];
    fetchMock.mockResolvedValueOnce(finished(response([textItem("Done")])));
    await new Client().complete("model-b", "", history, []);
    const input = JSON.parse(fetchMock.mock.calls[1][1].body).input;
    expect(input.map((item: { type: string }) => item.type)).toEqual([
      "message",
      "function_call",
      "function_call_output",
    ]);
  });

  it.each(["model", "instructions", "tools"] as const)(
    "clears old bindings once when changing %s and replays fresh reasoning after a tool call",
    async (change) => {
      const client = new Client();
      const write = vi.fn(async () => [{ type: "text" as const, text: "Written" }]);
      const tools: Tool[] = [{ name: "write", parameters: { type: "object", properties: {} }, function: write }];
      fetchMock.mockResolvedValueOnce(finished(response([reasoningItem("rs_old"), callItem()])));
      const first = await client.complete("model-a", "Original instructions", prompt, tools);
      const history: Message[] = [
        ...prompt,
        first,
        {
          role: "user",
          content: [{ type: "tool_result", id: "call_test", name: "write", arguments: "{}", result: [] }],
        },
      ];
      const original = structuredClone(history);
      const changedTools: Tool[] =
        change === "tools"
          ? [{ ...tools[0], parameters: { type: "object", properties: { path: { type: "string" } } } }]
          : tools;
      fetchMock
        .mockResolvedValueOnce(
          finished(response([reasoningItem("rs_new"), { ...callItem(), id: "fc_new", call_id: "call_new" }])),
        )
        .mockResolvedValueOnce(finished(response([textItem("Done")])));
      const changes: Message[][] = [];
      const result = await run(
        client,
        change === "model" ? "model-b" : "model-a",
        change === "instructions" ? "Updated instructions" : "Original instructions",
        history,
        changedTools,
        { onMessagesChange: (messages) => changes.push(messages) },
      );
      expect(result.status).toBe("completed");
      expect(write).toHaveBeenCalledOnce();
      const switched = JSON.parse(fetchMock.mock.calls[1][1].body);
      const continued = JSON.parse(fetchMock.mock.calls[2][1].body);
      expect(switched.input.filter((item: { type: string }) => item.type === "reasoning")).toEqual([]);
      expect(continued.input.filter((item: { type: string }) => item.type === "reasoning")).toEqual([
        expect.objectContaining({ id: "rs_new", encrypted_content: "encrypted-rs_new" }),
      ]);
      expect(changes[0][1].content[0]).toEqual({ type: "reasoning", id: "rs_old", text: "", summary: "Plan" });
      expect(history).toEqual(original);

      // Restoring persisted history and switching back must not resurrect old payloads.
      const saved: Message[] = JSON.parse(JSON.stringify(result.messages));
      fetchMock.mockResolvedValueOnce(finished(response([textItem("Continued after restoring")])));
      const restored = await run(client, "model-a", "Original instructions", saved, tools);
      expect(restored.status).toBe("completed");
      const back = JSON.parse(fetchMock.mock.calls[3][1].body);
      expect(back.input.filter((item: { type: string }) => item.type === "reasoning")).toEqual([]);
      expect(write).toHaveBeenCalledOnce();
    },
  );

  it.each(["all_turns", "current_turn", "auto", undefined] as const)(
    "preserves reasoning across saved human turns and lets the provider apply context mode %s",
    async (context) => {
      const client = new Client();
      const model = "gpt-5.6-sol";
      fetchMock.mockResolvedValueOnce(
        finished(
          response([reasoningItem("rs_first"), textItem("First answer")], {
            model,
            reasoning: context ? { context } : undefined,
          }),
        ),
      );
      const first = await run(client, model, "", prompt, []);
      expect(first.status).toBe("completed");
      const saved: Message[] = JSON.parse(JSON.stringify(first.messages));
      expect(saved.at(-1)?.usage?.reasoningContext).toBe(context === "auto" ? undefined : context);
      fetchMock.mockResolvedValueOnce(finished(response([textItem("Follow-up answer")], { model })));
      const second = await run(
        client,
        model,
        "",
        [...saved, { role: "user", content: [{ type: "text", text: "Continue the previous analysis" }] }],
        [],
      );
      expect(second.status).toBe("completed");
      const followup = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(followup.input.filter((item: { type: string }) => item.type === "reasoning")).toEqual([
        expect.objectContaining({ id: "rs_first", encrypted_content: "encrypted-rs_first" }),
      ]);
      expect(followup.reasoning?.context).toBeUndefined();
    },
  );

  it.each(["in_progress", "incomplete"] as const)(
    "omits %s reasoning while recovering truncated tool arguments",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(
          finished(
            response([reasoningItem("rs_partial", status), callItem("{", "incomplete")], {
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
            }),
          ),
        )
        .mockResolvedValueOnce(finished(response([textItem("Recovered")])));
      const write = vi.fn(async () => [{ type: "text" as const, text: "Written" }]);
      const result = await run(new Client(), "model", "", prompt, [
        { name: "write", parameters: { type: "object" }, function: write },
      ]);
      expect(result.status).toBe("completed");
      expect(write).not.toHaveBeenCalled();
      const next = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(next.input.filter((item: { type: string }) => item.type === "reasoning")).toEqual([]);
      expect(next.input.find((item: { type: string }) => item.type === "function_call_output").output).toContain(
        "incomplete",
      );
      expect(result.messages[1].content[0]).toEqual({ type: "reasoning", id: "rs_partial", text: "", summary: "Plan" });
    },
  );

  it.each([400, 413, 422, "error", "response.failed"] as const)(
    "recovers a %s reasoning rejection without losing the conversation",
    async (transport) => {
      const client = new Client();
      fetchMock.mockResolvedValueOnce(finished(response([reasoningItem("rs_old"), textItem("First answer")])));
      const first = await client.complete("model", "", prompt, []);
      const history: Message[] = [...prompt, first, { role: "user", content: [{ type: "text", text: "Continue" }] }];
      const error = { code: "invalid_encrypted_content", message: "Encrypted content could not be verified" };
      const rejection =
        typeof transport === "number"
          ? new Response(JSON.stringify({ error }), {
              status: transport,
              headers: { "content-type": "application/json" },
            })
          : sse([
              { type: "response.created", response: response([], { status: "in_progress" }) },
              transport === "error"
                ? { type: "error", ...error }
                : { type: "response.failed", response: { ...response(), status: "failed", error } },
            ]);
      fetchMock.mockResolvedValueOnce(rejection).mockResolvedValueOnce(finished(response([textItem("Recovered")])));
      const result = await run(client, "model", "", history, []);
      expect(result.status).toBe("completed");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const rejected = JSON.parse(fetchMock.mock.calls[1][1].body);
      const retried = JSON.parse(fetchMock.mock.calls[2][1].body);
      expect(rejected.input.some((item: { type: string }) => item.type === "reasoning")).toBe(true);
      expect(retried.input.filter((item: { type: string }) => item.type === "reasoning")).toEqual([]);
      expect(retried.input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "assistant", content: "First answer" }),
          expect.objectContaining({ role: "user", content: [{ type: "input_text", text: "Continue" }] }),
        ]),
      );
      expect(result.messages[1].content[0]).toEqual({ type: "reasoning", id: "rs_old", text: "", summary: "Plan" });
    },
  );

  it("clears partial content before retrying rather than appending it to the new response", async () => {
    fetchMock
      .mockResolvedValueOnce(
        sse([
          { type: "response.created", response: response([], { status: "in_progress" }) },
          { type: "response.output_item.added", output_index: 0, item: { ...textItem(""), content: [] } },
          {
            type: "response.content_part.added",
            output_index: 0,
            content_index: 0,
            item_id: "msg_test",
            part: { type: "output_text", text: "", annotations: [] },
          },
          {
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            item_id: "msg_test",
            delta: "Interrupted partial",
          },
        ]),
      )
      .mockResolvedValueOnce(finished(response([textItem("Recovered")])));
    const snapshots: Content[][] = [];
    const result = await new Client().complete("model", "", prompt, [], (content) => snapshots.push(content));
    expect(snapshots).toEqual([
      [{ type: "text", text: "Interrupted partial" }],
      [],
      [{ type: "text", text: "Recovered" }],
    ]);
    expect(result.content).toEqual([{ type: "text", text: "Recovered" }]);
  });

  it("never executes function calls from a content-filtered response", async () => {
    fetchMock.mockResolvedValueOnce(
      finished(response([callItem()], { status: "incomplete", incomplete_details: { reason: "content_filter" } })),
    );
    const execute = vi.fn();
    const result = await run(new Client(), "model", "", prompt, [
      { name: "write", parameters: { type: "object" }, function: execute },
    ]);
    expect(result.error?.code).toBe("CONTENT_FILTERED");
    expect(execute).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("commits authoritative final output even when no deltas were sent", async () => {
    fetchMock.mockResolvedValueOnce(finished(response([textItem("Final answer")])));
    const result = await new Client().complete("model", "instructions", prompt, []);
    expect(result.content).toEqual([{ type: "text", text: "Final answer" }]);
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ store: false, truncation: "disabled" });
  });

  it("renders refusal output instead of completing with an empty answer", async () => {
    const refusal: ResponseOutputItem = {
      id: "refusal",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "refusal", refusal: "I cannot help with that." }],
    };
    fetchMock.mockResolvedValueOnce(finished(response([refusal])));
    const result = await new Client().complete("model", "", prompt, []);
    expect(result.content).toEqual([{ type: "text", text: "I cannot help with that." }]);
  });

  it("retries clean EOF before a terminal response without executing partial tool calls", async () => {
    fetchMock
      .mockResolvedValueOnce(
        sse([
          { type: "response.created", response: response([], { status: "in_progress" }) },
          { type: "response.output_item.added", output_index: 0, item: callItem("{}", "in_progress") },
        ]),
      )
      .mockResolvedValueOnce(finished(response([textItem("Recovered")])));
    const execute = vi.fn();
    const tool: Tool = { name: "write", parameters: { type: "object" }, function: execute };
    const result = await run(new Client(), "model", "", prompt, [tool]);
    expect(result.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(result.messages.at(-1)?.content).toEqual([{ type: "text", text: "Recovered" }]);
  });

  it("has one bounded retry layer for HTTP failures", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: { message: "Unavailable" } }), { status: 503 }),
    );
    await expect(new Client().complete("model", "", prompt, [])).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a failed response with a transient streaming error code", async () => {
    fetchMock
      .mockResolvedValueOnce(
        finished(response([], { status: "failed", error: { code: "server_error", message: "Try again" } })),
      )
      .mockResolvedValueOnce(finished(response([textItem("OK")])));
    expect((await new Client().complete("model", "", prompt, [])).content).toEqual([{ type: "text", text: "OK" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry or execute calls after a terminal provider failure", async () => {
    fetchMock.mockResolvedValueOnce(
      finished(
        response([callItem()], { status: "failed", error: { code: "invalid_prompt", message: "Invalid prompt" } }),
      ),
    );
    const execute = vi.fn();
    const result = await run(new Client(), "model", "", prompt, [
      { name: "write", parameters: { type: "object" }, function: execute },
    ]);
    expect(result.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects cancellation without making a request when already stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new Client().complete("model", "", prompt, [], undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry after cancellation during backoff", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(sse([]));
    vi.mocked(errors.waitBeforeStreamRetry).mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(
      new Client().complete("model", "", prompt, [], undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps previously emitted content snapshots immutable", async () => {
    fetchMock.mockResolvedValueOnce(
      sse([
        { type: "response.created", response: response([], { status: "in_progress" }) },
        { type: "response.output_item.added", output_index: 0, item: { ...textItem(""), content: [] } },
        {
          type: "response.content_part.added",
          output_index: 0,
          content_index: 0,
          item_id: "msg_test",
          part: { type: "output_text", text: "", annotations: [] },
        },
        { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "msg_test", delta: "a" },
        { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "msg_test", delta: "b" },
        { type: "response.completed", response: response([textItem("ab")]) },
      ]),
    );
    const snapshots: Content[][] = [];
    await new Client().complete("model", "", prompt, [], (content) => snapshots.push(content));
    expect(snapshots.find((content) => content.length)?.[0]).toEqual({ type: "text", text: "a" });
  });

  it("marks truncated arguments from the final response even without item.done", async () => {
    fetchMock.mockResolvedValueOnce(
      finished(
        response([callItem('{"path":', "incomplete")], {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        }),
      ),
    );
    const result = await new Client().complete("model", "", prompt, []);
    expect(result.content).toEqual([expect.objectContaining({ type: "tool_call", incomplete: true })]);
  });

  it("reports truncated prose as an error instead of a successful empty answer", async () => {
    fetchMock.mockResolvedValueOnce(
      finished(
        response([textItem("Half a sentence")], {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        }),
      ),
    );
    await expect(new Client().complete("model", "", prompt, [])).rejects.toSatisfy(
      (error: unknown) => errors.getErrorInfo(error).code === "OUTPUT_TRUNCATED",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates summarizer errors so compaction can fall back", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "context_length_exceeded", message: "Context too large" } }), {
        status: 400,
      }),
    );
    await expect(new Client().summarizeHistory("small", prompt)).rejects.toMatchObject({
      code: "context_length_exceeded",
    });
  });
});
