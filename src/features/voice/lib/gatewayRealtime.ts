import {
  createRealtimeEventEmitter,
  type RealtimeAdapter,
  type RealtimeConnection,
  type RealtimeSessionConfig,
} from "@tanstack/ai";
import { AudioRecorder } from "./AudioRecorder";
import { AudioStreamPlayer } from "./AudioStreamPlayer";
import { captureRequestContext } from "@/shared/lib/requestContext";
import { getFinalTextFromContent } from "@/shared/lib/assistantText";
import { decodeBase64 } from "@/shared/lib/utils";
import { getTextFromContent, type Message } from "@/shared/types/chat";

type PendingResponse = { runId: string; calls: Set<string>; done: boolean; tools: boolean };
export type VoiceToolIdentity = { id: string; name: string; runId: string };
interface GatewayOptions {
  model: string;
  transcriber: string;
  config: RealtimeSessionConfig;
  history: Message[];
  signal: AbortSignal;
  inputDeviceId?: string;
  outputDeviceId?: string;
  runtimeContext: () => string | undefined;
  onAudioLevel?: (level: number) => void;
  onToolCall: (identity: VoiceToolIdentity) => void;
  onToolOutput: (identity: VoiceToolIdentity, output: string) => void;
  onClosed: (error?: Error) => void;
}

/**
 * Gateway transport/device adapter for TanStack RealtimeClient. The upstream
 * OpenAI adapter currently supports WebRTC only, with no gateway or device URL.
 * This adapter translates wire/audio events; RealtimeClient executes the tools.
 */
export function gatewayRealtime(options: GatewayOptions) {
  const events = createRealtimeEventEmitter();
  const identities = new WeakMap<object, VoiceToolIdentity>();
  const calls = new Map<string, VoiceToolIdentity>();
  const responses = new Map<string, PendingResponse>();
  const audioItems = new Map<string, string>();
  let socket: WebSocket | undefined;
  let recorder: AudioRecorder | undefined;
  let player: AudioStreamPlayer | undefined;
  let config = options.config;
  let closed = false;
  let configured = false;
  let ready = false;
  let currentTrack = crypto.randomUUID();
  let contextItem: string | undefined;
  let runId = crypto.randomUUID();
  let pauseCount = 0;
  let inputLevel = 0;
  let generation = 0;
  let pendingContinuation = false;
  let pendingText: { texts: string[]; done: Promise<void> } | undefined;
  let recentError: Error | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const whenReady = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Capture can be stopped before RealtimeClient starts awaiting readiness.
  void whenReady.catch(() => {});
  const live = () => !closed && !options.signal.aborted;
  const send = (event: object) => {
    if (live() && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  };
  const activeResponse = () => [...responses.values()].some((response) => !response.done);
  const refreshContext = () => {
    if (contextItem) send({ type: "conversation.item.delete", item_id: contextItem });
    contextItem = `ctx_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    runId = crypto.randomUUID();
    send({
      type: "conversation.item.create",
      item: {
        id: contextItem,
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: captureRequestContext(options.runtimeContext()) }],
      },
    });
  };
  const fail = (error: Error) => {
    if (!live()) return;
    recentError = error;
    events.emit("error", { error });
    options.onClosed(error);
    void disconnect();
  };
  const disconnect = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    rejectReady(new DOMException("Voice session closed", "AbortError"));
    options.signal.removeEventListener("abort", onAbort);
    const ws = socket;
    socket = undefined;
    if (ws && ws.readyState < 2) ws.close(1000, "Session ended");
    await Promise.allSettled([recorder?.end(), player?.disconnect()]);
    events.emit("status_change", { status: "idle" });
  };
  const onAbort = () => {
    void disconnect();
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  const interruptPlayback = async () => {
    const played = await player?.interrupt();
    if (!live()) return;
    const item = played?.trackId ? audioItems.get(played.trackId) : undefined;
    if (played?.wasPlaying && item)
      send({
        type: "conversation.item.truncate",
        item_id: item,
        content_index: 0,
        audio_end_ms: Math.floor(played.offsetSamples / 24),
      });
    events.emit("interrupted", {});
  };
  const drain = () => {
    if (pendingContinuation && !pendingText && !activeResponse()) {
      pendingContinuation = false;
      send({ type: "response.create" });
    }
  };
  const sendToolResult = (id: string, output: string) => {
    if (!live()) return;
    const identity = calls.get(id);
    if (!identity) return;
    calls.delete(id);
    send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: id, output } });
    options.onToolOutput(identity, output);
    for (const [responseId, response] of responses) {
      if (!response.calls.delete(id) || !response.done || response.calls.size) continue;
      responses.delete(responseId);
      if (response.tools) pendingContinuation = true;
    }
    drain();
  };
  const updateSession = (next: Partial<RealtimeSessionConfig>) => {
    config = { ...config, ...next };
    if (socket?.readyState !== WebSocket.OPEN) return;
    configured = true;
    send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: config.instructions,
        tools:
          config.tools?.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          })) ?? [],
        truncation: { type: "retention_ratio", retention_ratio: 0.8, token_limits: { post_instructions: 8000 } },
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: options.transcriber },
            noise_reduction: { type: "far_field" },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "auto",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { format: { type: "audio/pcm", rate: 24000 }, voice: config.voice ?? "alloy" },
        },
      },
    });
  };
  const record = async () => {
    await whenReady;
    if (!live() || pauseCount) return;
    await recorder?.record(({ mono }) => {
      if (!live() || pauseCount || !mono?.byteLength) return;
      const samples = new Int16Array(mono);
      inputLevel = Math.sqrt(samples.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0) / samples.length);
      options.onAudioLevel?.(inputLevel);
      send({ type: "input_audio_buffer.append", audio: encodePcm(mono) });
    });
  };
  const sendText = (text: string) => {
    if (!live()) return Promise.resolve();
    if (pendingText) {
      pendingText.texts.push(text);
      return pendingText.done;
    }
    if (activeResponse()) send({ type: "response.cancel" });
    const pending = { texts: [text], done: Promise.resolve() };
    pendingText = pending;
    pendingContinuation = false;
    pending.done = interruptPlayback()
      .then(() => {
        if (!live()) return;
        refreshContext();
        for (const text of pending.texts)
          send({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
          });
        pendingContinuation = false;
        send({ type: "response.create" });
      })
      .catch((error: Error) => fail(error))
      .finally(() => {
        if (pendingText === pending) pendingText = undefined;
      });
    return pending.done;
  };
  const connection: RealtimeConnection = {
    disconnect,
    startAudioCapture: record,
    stopAudioCapture: () => {
      void recorder?.pause().catch((error: Error) => fail(error));
    },
    sendText: (text) => {
      void sendText(text);
    },
    sendImage: (data, mime) =>
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            { type: "input_image", image_url: data.startsWith("data:") ? data : `data:${mime};base64,${data}` },
          ],
        },
      }),
    sendToolResult,
    updateSession,
    interrupt: () => {
      if (activeResponse()) send({ type: "response.cancel" });
      void interruptPlayback().catch((error: Error) => fail(error));
    },
    on: (event, handler) => events.on(event, handler),
    getAudioVisualization: () => ({
      get inputLevel() {
        return inputLevel;
      },
      outputLevel: 0,
      inputSampleRate: 24000,
      outputSampleRate: 24000,
      getInputFrequencyData: () => new Uint8Array(),
      getOutputFrequencyData: () => new Uint8Array(),
      getInputTimeDomainData: () => new Uint8Array(),
      getOutputTimeDomainData: () => new Uint8Array(),
    }),
  };
  const prepare = async () => {
    options.signal.throwIfAborted();
    player = new AudioStreamPlayer({ sampleRate: 24000, sinkId: options.outputDeviceId, onError: fail });
    try {
      await player.connect();
      options.signal.throwIfAborted();
      recorder = new AudioRecorder({ sampleRate: 24000, deviceId: options.inputDeviceId, onError: fail });
      await recorder.begin();
      options.signal.throwIfAborted();
      socket = new WebSocket(
        `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/v1/realtime?model=${encodeURIComponent(options.model)}`,
      );
      timer = setTimeout(() => fail(new Error("The voice service did not confirm its audio configuration.")), 15_000);
      socket.addEventListener("open", () => {
        if (!live()) return;
        updateSession(config);
        for (const message of options.history) {
          const text =
            message.role === "assistant"
              ? getFinalTextFromContent(message.content)
              : getTextFromContent(message.content);
          if (text.trim())
            send({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: message.role,
                content: [{ type: message.role === "user" ? "input_text" : "output_text", text }],
              },
            });
        }
      });
      socket.addEventListener("message", (event) => {
        if (!live()) return;
        try {
          const msg = JSON.parse(event.data);
          if (!msg || typeof msg.type !== "string") throw new Error("The voice service sent an invalid message.");
          switch (msg.type) {
            case "session.updated":
              if (configured && !ready) {
                ready = true;
                clearTimeout(timer);
                refreshContext();
                resolveReady();
              }
              break;
            case "input_audio_buffer.speech_started":
              refreshContext();
              void interruptPlayback().catch((error: Error) => fail(error));
              break;
            case "response.created":
              currentTrack = msg.response.id;
              responses.set(currentTrack, { runId, calls: new Set(), done: false, tools: false });
              events.emit("mode_change", { mode: "thinking" });
              break;
            case "conversation.item.input_audio_transcription.completed":
              if (msg.transcript?.trim())
                events.emit("transcript", { role: "user", transcript: msg.transcript, isFinal: true });
              break;
            case "response.output_audio.delta": {
              const track = msg.response_id ?? currentTrack;
              if (msg.item_id) audioItems.set(track, msg.item_id);
              const pcm = decodeBase64(msg.delta);
              player?.add16BitPCM(new Int16Array(pcm.buffer), track);
              events.emit("audio_chunk", { data: pcm.buffer, sampleRate: 24000 });
              events.emit("mode_change", { mode: "speaking" });
              break;
            }
            case "response.done": {
              const response = msg.response;
              const pending = responses.get(response.id);
              if (!pending || pending.done) break;
              pending.done = true;
              const output = response.output ?? [];
              const toolCalls = new Map<string, { name: string; arguments: string; status?: string }>();
              for (const item of output)
                if (item.type === "function_call" && item.call_id) toolCalls.set(item.call_id, item);
              pending.calls = new Set(toolCalls.keys());
              pending.tools = response.status === "completed" && toolCalls.size > 0;
              if (response.status === "completed") {
                const text = output
                  .flatMap((item: { type: string; content?: { transcript?: string; text?: string }[] }) =>
                    item.type === "message" ? (item.content ?? []) : [],
                  )
                  .map((part: { transcript?: string; text?: string }) => part.transcript ?? part.text ?? "")
                  .join("");
                if (text)
                  events.emit("message_complete", {
                    message: {
                      id: response.id,
                      role: "assistant",
                      timestamp: Date.now(),
                      parts: [{ type: "audio", transcript: text }],
                    },
                  });
              }
              for (const [id, call] of toolCalls) {
                const identity = { id, name: call.name, runId: pending.runId };
                calls.set(id, identity);
                options.onToolCall(identity);
                if (response.status !== "completed" || call.status === "incomplete" || call.status === "in_progress") {
                  sendToolResult(
                    id,
                    JSON.stringify({
                      error: "The response or tool arguments were incomplete; the tool was not executed.",
                    }),
                  );
                  continue;
                }
                let input: unknown;
                try {
                  input = JSON.parse(call.arguments);
                } catch {
                  sendToolResult(id, JSON.stringify({ error: "Malformed tool arguments; valid JSON is required." }));
                  continue;
                }
                if (input && typeof input === "object") identities.set(input, identity);
                events.emit("tool_call", { toolCallId: id, toolName: call.name, input });
              }
              if (!toolCalls.size) responses.delete(response.id);
              drain();
              break;
            }
            case "error":
              recentError = new Error(msg.error?.message ?? "The voice service reported an error.");
              if (!ready) fail(recentError);
              else events.emit("error", { error: recentError });
              break;
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Couldn't process a voice service event."));
        }
      });
      socket.addEventListener("error", () => fail(new Error("Couldn't connect to the voice service.")));
      socket.addEventListener("close", () => {
        if (live()) {
          options.onClosed(recentError);
          void disconnect();
        }
      });
    } catch (error) {
      await disconnect();
      throw error;
    }
  };
  return {
    prepare,
    disconnect,
    toolIdentity: (input: unknown) => (input && typeof input === "object" ? identities.get(input) : undefined),
    // RealtimeClient's executable tool list is immutable. Rebinding a client
    // switches event ownership, while earlier calls may still deliver results.
    adapter: (): RealtimeAdapter => {
      const owner = ++generation;
      return {
        provider: "wingman",
        connect: async () => ({
          ...connection,
          disconnect: async () => {},
          on: (event, handler) =>
            events.on(event, (payload) => {
              if (owner === generation) handler(payload);
            }),
        }),
      };
    },
    textSettled: () => pendingText?.done ?? Promise.resolve(),
    pauseAudio: async (flush = true) => {
      if (!live()) return async () => {};
      if (pauseCount++ === 0) {
        await recorder?.pause();
        if (flush) await interruptPlayback();
      }
      let resumed = false;
      return async () => {
        if (!live() || resumed) return;
        resumed = true;
        if (--pauseCount === 0) await record();
      };
    },
  };
}

function encodePcm(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
