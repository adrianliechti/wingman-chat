import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool, ToolContext } from "@/shared/types/chat";
import { useVoiceWebSockets, voiceSessionSignature } from "./useVoiceWebSockets";

const audio = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(),
  begin: vi.fn(async () => {}),
  end: vi.fn(async () => {}),
}));
vi.mock("@/features/voice/lib/AudioStreamPlayer", () => ({
  AudioStreamPlayer: class {
    connect = audio.connect;
    disconnect = audio.disconnect;
    interrupt = async () => ({ trackId: "", offsetSamples: 0, wasPlaying: false });
  },
}));
vi.mock("@/features/voice/lib/AudioRecorder", () => ({
  AudioRecorder: class {
    begin = audio.begin;
    end = audio.end;
    record = async () => {};
    pause = async () => {};
  },
}));

class Socket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  sent: Array<Record<string, any>> = [];
  constructor(_url: string) {
    super();
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  message(value: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

function createHarness(tools: Tool[] = [], getContext = () => "active_file: /first.txt") {
  const onResult = vi.fn();
  const onUser = vi.fn();
  let hook!: ReturnType<typeof useVoiceWebSockets>;
  function Harness() {
    hook = useVoiceWebSockets(onUser, vi.fn(), undefined, undefined, onResult, undefined, getContext);
    return null;
  }
  renderToString(<Harness />);
  return {
    onResult,
    onUser,
    hook,
    start: async () => {
      await hook.start("test", "test", "Static instructions", [], tools, undefined, undefined, undefined, () => ({
        chatId: "origin",
      }));
      const socket = Socket.instances.at(-1)!;
      socket.open();
      socket.message({ type: "session.updated" });
      return socket;
    },
  };
}

function toolCall(socket: Socket, args: Record<string, unknown>) {
  const item = { id: "item", type: "function_call", name: "edit", call_id: "call", arguments: JSON.stringify(args) };
  socket.message({ type: "response.created", response: { id: "response" } });
  socket.message({
    type: "response.output_item.done",
    response_id: "response",
    item,
  });
  socket.message({ type: "response.done", response: { id: "response", status: "completed", output: [item] } });
}

describe("voice request context and tool lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Socket.instances = [];
    vi.stubGlobal("WebSocket", Socket);
    vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost" }, setTimeout });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seeds voice with final assistant answers and all user text", async () => {
    const { hook } = createHarness();
    await hook.start(
      "test",
      "test",
      "Instructions",
      [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "there" },
          ],
        },
        { role: "assistant", content: [{ type: "text", text: "Still working", phase: "commentary" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Progress", phase: "commentary" },
            { type: "text", text: "Final answer", phase: "final_answer" },
          ],
        },
      ],
      [],
    );
    const socket = Socket.instances.at(-1)!;
    socket.open();
    socket.message({ type: "session.updated" });
    expect(
      socket.sent
        .filter((event) => event.type === "conversation.item.create" && event.item.role !== "system")
        .map((event) => event.item.content),
    ).toEqual([[{ type: "input_text", text: "Hello there" }], [{ type: "output_text", text: "Final answer" }]]);
    await hook.stop();
  });

  it("executes calls from the final response even when item events are missing", async () => {
    const handler = vi.fn<Tool["function"]>(async () => []);
    const { hook, start } = createHarness([{ name: "edit", parameters: { type: "object" }, function: handler }]);
    const socket = await start();
    socket.message({ type: "response.created", response: { id: "response" } });
    socket.message({
      type: "response.done",
      response: {
        id: "response",
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "call",
            name: "edit",
            arguments: '{"value":"final"}',
            status: "completed",
          },
        ],
      },
    });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledExactlyOnceWith({ value: "final" }, expect.anything());
    await hook.stop();
  });

  it.each(["completed", "incomplete"])(
    "uses the final tool arguments and %s status instead of earlier item events",
    async (status) => {
      const handler = vi.fn<Tool["function"]>(async () => []);
      const { hook, start } = createHarness([{ name: "edit", parameters: { type: "object" }, function: handler }]);
      const socket = await start();
      socket.message({ type: "response.created", response: { id: "response" } });
      socket.message({
        type: "response.output_item.done",
        response_id: "response",
        item: {
          type: "function_call",
          call_id: "call",
          name: "edit",
          arguments: '{"value":"stale"}',
        },
      });
      socket.message({
        type: "response.done",
        response: {
          id: "response",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "call",
              name: "edit",
              arguments: '{"value":"final"}',
              status,
            },
          ],
        },
      });
      await Promise.resolve();
      if (status === "completed")
        expect(handler).toHaveBeenCalledExactlyOnceWith({ value: "final" }, expect.anything());
      else {
        expect(handler).not.toHaveBeenCalled();
        expect(socket.sent.some((event) => event.item?.output?.includes("incomplete"))).toBe(true);
      }
      await hook.stop();
    },
  );

  it("ignores duplicate terminal events while tools are still running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn<Tool["function"]>(async () => {
      await gate;
      return [];
    });
    const { hook, start } = createHarness([{ name: "edit", parameters: { type: "object" }, function: handler }]);
    const socket = await start();
    socket.message({ type: "response.created", response: { id: "response" } });
    const output = ["a", "b"].map((call_id) => ({ type: "function_call", call_id, name: "edit", arguments: "{}" }));
    output.forEach((item) => socket.message({ type: "response.output_item.done", response_id: "response", item }));
    const done = { type: "response.done", response: { id: "response", status: "completed", output } };
    socket.message(done);
    socket.message(done);
    release();
    await gate;
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(socket.sent.filter((event) => event.type === "response.create")).toHaveLength(1);
    await hook.stop();
  });

  it("updates the static session when schemas or the helper model change, but not callback identity", () => {
    const tool: Tool = { name: "edit", parameters: { type: "object", properties: {} }, function: async () => [] };
    const signature = voiceSessionSignature("static", [tool], "model-a");
    expect(voiceSessionSignature("static", [{ ...tool, function: async () => [] }], "model-a")).toBe(signature);
    expect(
      voiceSessionSignature(
        "static",
        [{ ...tool, parameters: { ...tool.parameters, additionalProperties: false } }],
        "model-a",
      ),
    ).not.toBe(signature);
    expect(voiceSessionSignature("static", [tool], "model-b")).not.toBe(signature);
  });

  it("replaces late context without changing session instructions", async () => {
    let file = "/first.txt";
    const { hook, start } = createHarness([], () => `active_file: ${file}`);
    const socket = await start();
    const first = socket.sent.find((event) => event.item?.role === "system")!;
    file = "/second.txt";
    await hook.sendText("Edit this");
    const contexts = socket.sent.filter((event) => event.item?.role === "system");
    expect(contexts).toHaveLength(2);
    expect(contexts[1].item.content[0].text).toContain("/second.txt");
    expect(socket.sent).toContainEqual({ type: "conversation.item.delete", item_id: first.item.id });
    expect(socket.sent.filter((event) => event.type === "session.update")).toHaveLength(1);
    expect(socket.sent[0].session.instructions).toBe("Static instructions");
    await hook.stop();
  });

  it("validates canonical arguments before invoking voice tools", async () => {
    const handler = vi.fn(async () => []);
    const { hook, start, onResult } = createHarness([
      {
        name: "edit",
        parameters: {
          type: "object",
          properties: { file_path: { type: "string" } },
          required: ["file_path"],
          additionalProperties: false,
        },
        function: handler,
      },
    ]);
    const socket = await start();
    toolCall(socket, { path: "/wrong-alias.txt" });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(handler).not.toHaveBeenCalled();
    await hook.stop();
  });

  it.each(["failed", "incomplete", "cancelled"])(
    "never executes deferred tools after a %s response",
    async (status) => {
      const handler = vi.fn(async () => []);
      const { start, hook } = createHarness([{ name: "edit", parameters: { type: "object" }, function: handler }]);
      const socket = await start();
      socket.message({ type: "response.created", response: { id: "response" } });
      socket.message({
        type: "response.output_item.done",
        response_id: "response",
        item: { id: "item", type: "function_call", name: "edit", call_id: "call", arguments: "{}" },
      });
      socket.message({
        type: "response.done",
        response: {
          id: "response",
          status,
          output: [{ id: "item", type: "function_call", name: "edit", call_id: "call", arguments: "{}" }],
        },
      });
      await Promise.resolve();
      expect(handler).not.toHaveBeenCalled();
      expect(
        socket.sent.some(
          (event) => event.item?.type === "function_call_output" && event.item.output.includes("not executed"),
        ),
      ).toBe(true);
      await hook.stop();
    },
  );

  it("uses authoritative final arguments and ignores duplicate call events", async () => {
    const handler = vi.fn<Tool["function"]>(async () => []);
    const { start, hook, onResult } = createHarness([
      { name: "edit", parameters: { type: "object" }, function: handler },
    ]);
    const socket = await start();
    socket.message({ type: "response.created", response: { id: "response" } });
    socket.message({ type: "response.function_call_arguments.delta", item_id: "item", delta: '{"value":"stale"}' });
    const event = {
      type: "response.output_item.done",
      response_id: "response",
      item: { id: "item", type: "function_call", name: "edit", call_id: "call", arguments: '{"value":"final"}' },
    };
    socket.message(event);
    socket.message(event);
    socket.message({
      type: "response.done",
      response: { id: "response", status: "completed", output: [event.item, event.item] },
    });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ value: "final" });
    await hook.stop();
  });

  it("aborts in-flight tools and ignores late results and socket messages after stop", async () => {
    let context: ToolContext | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { hook, start, onResult, onUser } = createHarness([
      {
        name: "edit",
        parameters: { type: "object", properties: {} },
        function: async (_args, ctx) => {
          context = ctx;
          await gate;
          return [{ type: "text", text: "late" }];
        },
      },
    ]);
    const socket = await start();
    toolCall(socket, {});
    await vi.waitFor(() => expect(context?.signal).toBeDefined());
    expect(context?.chatId).toBe("origin");
    await hook.stop();
    expect(context?.signal?.aborted).toBe(true);
    release();
    await gate;
    socket.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "late user" });
    expect(onResult).not.toHaveBeenCalled();
    expect(onUser).not.toHaveBeenCalled();
  });

  it("does not create a socket when stopped during device initialization", async () => {
    let release!: () => void;
    audio.begin.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { hook } = createHarness();
    const starting = hook.start("test");
    await vi.waitFor(() => expect(release).toBeDefined());
    await hook.stop();
    release();
    await starting;
    expect(Socket.instances).toHaveLength(0);
    expect(audio.end).toHaveBeenCalled();
    expect(audio.disconnect).toHaveBeenCalled();
  });
});
