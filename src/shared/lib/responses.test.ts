import type {
  Response as ModelResponse,
  ResponseOutputItem,
  ResponseOutputMessage,
} from "openai/resources/responses/responses";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LengthFinishReasonError } from "openai/error";
import { z } from "zod/v3";
import type { Content, Tool } from "../types/chat";
import { run } from "./agent";
import { Client } from "./client";
import { responseContent, toResponseInput } from "./responses";

function message(text: string, phase?: ResponseOutputMessage["phase"], id = "msg_test"): ResponseOutputMessage {
  return {
    id,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
    ...(phase ? { phase } : {}),
  };
}

function response(output: ResponseOutputItem[], fields: Partial<ModelResponse> = {}): ModelResponse {
  return {
    id: "resp_test",
    object: "response",
    created_at: 0,
    model: "model",
    status: "completed",
    error: null,
    incomplete_details: null,
    output,
    ...fields,
  } as ModelResponse;
}

function sse(output: ResponseOutputItem[], events: object[] = []): Response {
  return new Response(
    [
      { type: "response.created", response: response([], { status: "in_progress" }) },
      ...events,
      { type: "response.completed", response: response(output) },
    ]
      .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: new URL("http://localhost") });
});
afterEach(() => vi.unstubAllGlobals());

describe("structured output with multiple assistant messages (real SDK)", () => {
  const schema = z.object({ content: z.string() }).strict();
  const parse = () => new Client().parse("model", "Return code as JSON", "Go", schema, "code");
  const final = JSON.stringify({ content: 'print("done")\n' });
  const respond = (output: ResponseOutputItem[], fields: Partial<ModelResponse> = {}) =>
    fetchMock.mockResolvedValueOnce(Response.json(response(output, fields)));

  it.each(['{"content":"working"}', "I will write the script.", '{"content":', '{"progress":true}'])(
    "parses only the final message after commentary %s",
    async (commentary) => {
      respond([message(commentary, "commentary"), message(final, "final_answer")]);
      expect(await parse()).toEqual({ content: 'print("done")\n' });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).text.format).toMatchObject({
        type: "json_schema",
        name: "code",
        strict: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("selects the last final message without concatenating independent JSON objects", async () => {
    respond([message('{"content":"draft"}', "final_answer"), message(final, "final_answer")]);
    expect(await parse()).toEqual({ content: 'print("done")\n' });
  });

  it("uses the last unphased message when the provider omits phases", async () => {
    respond([message("Working"), message(final)]);
    expect(await parse()).toEqual({ content: 'print("done")\n' });
  });

  it("prefers an explicit final answer over unphased text", async () => {
    respond([message(final, "final_answer"), message("Trailing provider text")]);
    expect(await parse()).toEqual({ content: 'print("done")\n' });
  });

  it("joins text parts within the selected message", async () => {
    const item = message(final.slice(0, 12), "final_answer");
    item.content.push({ type: "output_text", text: final.slice(12), annotations: [] });
    respond([item]);
    expect(await parse()).toEqual({ content: 'print("done")\n' });
  });

  it("returns no structured result for a final refusal instead of earlier valid commentary", async () => {
    const refusal = message("", "final_answer");
    refusal.content = [{ type: "refusal", refusal: "Cannot answer" }];
    respond([message(final, "commentary"), refusal]);
    expect(await parse()).toBeNull();
  });

  it("does not treat commentary alone as a final result", async () => {
    respond([message(final, "commentary")]);
    expect(await parse()).toBeNull();
  });

  it.each(['{"content":', '{"unexpected":true}', '{"content":"a"}{"content":"b"}'])(
    "rejects an invalid final answer without falling back to valid commentary: %s",
    async (invalid) => {
      respond([message(final, "commentary"), message(invalid, "final_answer")]);
      await expect(parse()).rejects.toThrow();
    },
  );

  it("reports truncation before trying to parse unfinished JSON", async () => {
    respond([message(final, "commentary"), message('{"content":', "final_answer")], {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    });
    await expect(parse()).rejects.toBeInstanceOf(LengthFinishReasonError);
  });

  it("rejects an unfinished final message even when the response says completed", async () => {
    respond([message(final, "commentary"), { ...message(final, "final_answer"), status: "incomplete" }]);
    await expect(parse()).rejects.toThrow();
  });
});

describe("assistant message boundaries", () => {
  const output = [
    message("First update.", "commentary", "msg_first"),
    message("Second update.", "commentary", "msg_second"),
    message('{"content":"final"}', "final_answer", "msg_final"),
  ];
  const expected = output.map((item) => ({
    type: "text",
    text: item.content[0].type === "output_text" ? item.content[0].text : "",
    phase: item.phase,
  }));

  it("preserves phases and separate messages when replaying history", () => {
    const content = responseContent(response(output));
    expect(content).toEqual(expected);
    expect(toResponseInput([{ role: "assistant", content }])).toEqual(
      expected.map((part) => ({ type: "message", role: "assistant", content: part.text, phase: part.phase })),
    );
  });

  it("keeps text deltas within their message and carries the phase into streamed snapshots", async () => {
    const events = output.flatMap((item, output_index) => [
      { type: "response.output_item.added", output_index, item: { ...item, content: [] } },
      {
        type: "response.content_part.added",
        output_index,
        item_id: item.id,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      },
      ...expected[output_index].text.match(/.{1,5}/g)!.map((delta) => ({
        type: "response.output_text.delta",
        output_index,
        item_id: item.id,
        content_index: 0,
        delta,
      })),
      { type: "response.output_item.done", output_index, item },
    ]);
    fetchMock.mockResolvedValueOnce(sse(output, events));
    const snapshots: Content[][] = [];
    const result = await new Client().complete("model", "", [], [], (content) => snapshots.push(content));
    expect(snapshots.slice(0, -1)).toContainEqual(expected);
    expect(result.content).toEqual(expected);
    expect(snapshots[0]).toEqual([{ type: "text", text: "First", phase: "commentary" }]);
  });

  it("dispatches Python and file arguments independently of commentary and interleaved call deltas", async () => {
    const code = 'print("hello")\npattern = r"\\d+"\n';
    const args = [{ code }, { file_path: "/script.py", content: code }];
    const execute = vi.fn().mockResolvedValue([{ type: "text", text: "OK" }]);
    const write = vi.fn().mockResolvedValue([{ type: "text", text: "OK" }]);
    const tools: Tool[] = [
      {
        name: "execute_python_code",
        parameters: { type: "object", properties: { code: { type: "string" } } },
        function: execute,
      },
      {
        name: "create_file",
        parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } } },
        function: write,
      },
    ];
    const calls = tools.map((tool, i) => ({
      type: "function_call" as const,
      id: `fc_${i}`,
      call_id: `call_${i}`,
      name: tool.name,
      arguments: JSON.stringify(args[i]),
      status: "completed" as const,
    }));
    const events: object[] = calls.map((item, i) => ({
      type: "response.output_item.added",
      output_index: i,
      item: { ...item, arguments: "" },
    }));
    for (let offset = 0; offset < Math.max(...calls.map((call) => call.arguments.length)); offset += 5) {
      calls.forEach((call, output_index) => {
        events.push({
          type: "response.function_call_arguments.delta",
          output_index,
          item_id: call.id,
          delta: call.arguments.slice(offset, offset + 5),
        });
      });
    }
    fetchMock.mockResolvedValueOnce(sse([...calls, message('{"content":"working"}', "commentary")], events));
    fetchMock.mockResolvedValueOnce(sse([message('{"content":"done"}', "final_answer")]));
    await run(new Client(), "model", "", [{ role: "user", content: [{ type: "text", text: "Go" }] }], tools);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual(args[0]);
    expect(write.mock.calls[0][0]).toEqual(args[1]);
  });
});
