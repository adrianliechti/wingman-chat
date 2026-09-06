import { useCallback, useEffect, useRef } from "react";
import { AudioRecorder } from "@/features/voice/lib/AudioRecorder";
import { AudioStreamPlayer } from "@/features/voice/lib/AudioStreamPlayer";
import { parseToolArguments, toolArgumentHints } from "@/shared/lib/toolArguments";
import { compileToolRegistry, type ToolRegistry } from "@/shared/lib/toolRegistry";
import { captureRequestContext } from "@/shared/lib/requestContext";
import { getFinalTextFromContent } from "@/shared/lib/assistantText";
import { decodeBase64, serializeToolResultForApi } from "@/shared/lib/utils";
import type {
  AudioContent,
  FileContent,
  ImageContent,
  Message,
  TextContent,
  Tool,
  ToolContext,
} from "@/shared/types/chat";
import { getTextFromContent } from "@/shared/types/chat";

export type ToolContextFactory = (toolCall: { id: string; name: string }) => ToolContext;

/** Compare the actual static contract, not just tool names or a lossy hash. */
export function voiceSessionSignature(instructions: string, tools: Tool[], model?: string): string {
  return JSON.stringify([
    model,
    instructions,
    tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
  ]);
}

interface DeferredToolCall {
  callId: string;
  toolName: string;
  argsStr: string;
  incomplete: boolean;
}

interface PendingResponse {
  runId: string;
  callIds: Set<string>;
  done: boolean;
  hadToolCalls: boolean;
}

export function useVoiceWebSockets(
  onUser: (text: string) => void,
  onAssistant: (text: string) => void,
  onToolCall?: (toolName: string, callId: string) => void,
  onToolCallDone?: (callId: string) => void,
  onToolResult?: (
    toolName: string,
    callId: string,
    result: (TextContent | ImageContent | AudioContent | FileContent)[],
  ) => void,
  onClosed?: (reason?: { fatal: boolean; message: string }) => void,
  getRuntimeContext?: () => string,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const sessionControllerRef = useRef<AbortController | null>(null);
  const wavPlayerRef = useRef<AudioStreamPlayer | null>(null);
  const wavRecorderRef = useRef<AudioRecorder | null>(null);
  const recordCallbackRef = useRef<((data: { mono: ArrayBuffer | null }) => void) | null>(null);
  const trackIdRef = useRef<string>(crypto.randomUUID());

  const isActiveRef = useRef(false);
  const audioPausedRef = useRef(false);

  // Recent error timestamp; a close shortly after is treated as session-fatal.
  const lastErrorRef = useRef<{ message: string; at: number } | null>(null);

  const pendingResponsesRef = useRef<Map<string, PendingResponse>>(new Map());
  // response_id → assistant audio item_id, needed to truncate the right item
  // when the user interrupts (playback outlives response.done, so entries are
  // only cleared on stop).
  const audioItemByResponseRef = useRef<Map<string, string>>(new Map());
  const pendingPostToolFireRef = useRef<boolean>(false);
  const pendingTextRef = useRef<{ texts: string[]; done: Promise<void> } | null>(null);
  const toolRegistryRef = useRef<ToolRegistry | undefined>(undefined);
  const toolContextFactoryRef = useRef<ToolContextFactory | undefined>(undefined);
  const runtimeContextRef = useRef(getRuntimeContext);
  runtimeContextRef.current = getRuntimeContext;
  const contextItemIdRef = useRef<string | null>(null);
  const voiceRunIdRef = useRef(crypto.randomUUID());

  // A replaceable late conversation item, never part of session instructions or saved chat.
  const refreshRequestContext = useCallback((ws: WebSocket) => {
    if (contextItemIdRef.current) {
      ws.send(JSON.stringify({ type: "conversation.item.delete", item_id: contextItemIdRef.current }));
    }
    const id = `ctx_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    contextItemIdRef.current = id;
    voiceRunIdRef.current = crypto.randomUUID();
    ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          id,
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: captureRequestContext(runtimeContextRef.current?.()) }],
        },
      }),
    );
  }, []);

  const onUserRef = useRef(onUser);
  const onAssistantRef = useRef(onAssistant);
  const onToolCallRef = useRef(onToolCall);
  const onToolCallDoneRef = useRef(onToolCallDone);
  const onToolResultRef = useRef(onToolResult);
  const onClosedRef = useRef(onClosed);

  useEffect(() => {
    onUserRef.current = onUser;
    onAssistantRef.current = onAssistant;
    onToolCallRef.current = onToolCall;
    onToolCallDoneRef.current = onToolCallDone;
    onToolResultRef.current = onToolResult;
    onClosedRef.current = onClosed;
  }, [onUser, onAssistant, onToolCall, onToolCallDone, onToolResult, onClosed]);

  // Keep the server's conversation aligned with what was actually heard,
  // including interruptions before the first sample and playback after response.done.
  const interruptPlayback = useCallback(async () => {
    const controller = sessionControllerRef.current;
    const ws = wsRef.current;
    const result = await wavPlayerRef.current?.interrupt();
    if (!controller || controller.signal.aborted || sessionControllerRef.current !== controller) return;
    if (!ws || ws.readyState !== WebSocket.OPEN || !result?.wasPlaying || !result.trackId) return;
    const itemId = audioItemByResponseRef.current.get(result.trackId);
    if (!itemId) return;
    ws.send(
      JSON.stringify({
        type: "conversation.item.truncate",
        item_id: itemId,
        content_index: 0,
        audio_end_ms: Math.floor((result.offsetSamples / 24000) * 1000),
      }),
    );
  }, []);

  const pauseCountRef = useRef(0);
  // Return a resume function bound to this session, so a late tool/elicitation
  // cannot resume a replacement session. Concurrent elicitations share the pause.
  const pauseAudio = useCallback(
    async (flushPlayback = true) => {
      const controller = sessionControllerRef.current;
      if (!controller) return async () => {};
      const recorder = wavRecorderRef.current;
      const first = pauseCountRef.current++ === 0;
      audioPausedRef.current = true;
      if (first) {
        await recorder?.pause();
        if (flushPlayback && controller === sessionControllerRef.current) await interruptPlayback();
      }
      let resumed = false;
      return async () => {
        if (resumed || !controller || controller.signal.aborted || controller !== sessionControllerRef.current) return;
        resumed = true;
        if (--pauseCountRef.current > 0) return;
        audioPausedRef.current = false;
        if (recorder && recordCallbackRef.current) await recorder.record(recordCallbackRef.current);
      };
    },
    [interruptPlayback],
  );

  const stop = useCallback(async () => {
    isActiveRef.current = false;
    const controller = sessionControllerRef.current;
    sessionControllerRef.current = null;
    // Detach every owned resource before awaiting any browser cleanup.
    const recorder = wavRecorderRef.current;
    wavRecorderRef.current = null;
    const player = wavPlayerRef.current;
    wavPlayerRef.current = null;
    const ws = wsRef.current;
    wsRef.current = null;
    recordCallbackRef.current = null;
    audioPausedRef.current = false;
    pauseCountRef.current = 0;
    pendingResponsesRef.current.clear();
    audioItemByResponseRef.current.clear();
    pendingPostToolFireRef.current = false;
    pendingTextRef.current = null;
    contextItemIdRef.current = null;
    controller?.abort();
    try {
      if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        ws.close(1000, "User stopped session");
      }
    } catch {
      /* A closing socket still must release its audio. */
    }
    await Promise.allSettled([
      (async () => {
        await recorder?.end();
      })(),
      (async () => {
        await player?.disconnect();
      })(),
    ]);
  }, []);

  const hasOtherActiveResponse = useCallback((excludeId?: string) => {
    for (const [id, entry] of pendingResponsesRef.current.entries()) {
      if (id === excludeId) continue;
      if (!entry.done) return true;
    }
    return false;
  }, []);

  const checkAndFireResponseCreate = useCallback(
    (responseId: string, ws: WebSocket) => {
      const entry = pendingResponsesRef.current.get(responseId);
      if (!entry) return;
      if (entry.done && entry.callIds.size === 0 && entry.hadToolCalls) {
        pendingResponsesRef.current.delete(responseId);
        if (ws.readyState !== WebSocket.OPEN) return;
        if (pendingTextRef.current || hasOtherActiveResponse()) {
          pendingPostToolFireRef.current = true;
          return;
        }
        ws.send(JSON.stringify({ type: "response.create" }));
      }
    },
    [hasOtherActiveResponse],
  );

  const drainPendingPostToolFires = useCallback(
    (ws: WebSocket) => {
      if (!pendingPostToolFireRef.current) return;
      if (pendingTextRef.current || hasOtherActiveResponse()) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      pendingPostToolFireRef.current = false;
      ws.send(JSON.stringify({ type: "response.create" }));
    },
    [hasOtherActiveResponse],
  );

  const start = useCallback(
    async (
      realtimeModel: string = "gpt-realtime-2.1",
      transcribeModel: string = "gpt-live-transcribe",
      instructions?: string,
      messages?: Message[],
      tools?: Tool[],
      inputDeviceId?: string,
      outputDeviceId?: string,
      onAudioLevel?: (level: number) => void,
      toolContextFactory?: ToolContextFactory,
      onReady?: () => void,
    ) => {
      if (isActiveRef.current) return;
      isActiveRef.current = true;
      const sessionController = new AbortController();
      sessionControllerRef.current = sessionController;
      lastErrorRef.current = null;

      toolContextFactoryRef.current = toolContextFactory;
      const isCurrent = () => !sessionController.signal.aborted && sessionControllerRef.current === sessionController;
      const closeSession = (reason?: { fatal: boolean; message: string }) => {
        if (!isCurrent()) return;
        void stop();
        // Notify synchronously; a delayed close must not reset the UI of a newer session.
        onClosedRef.current?.(reason);
      };
      const audioFailed = (error: Error) => closeSession({ fatal: true, message: error.message });

      try {
        toolRegistryRef.current = compileToolRegistry(tools ?? []);
        const player = new AudioStreamPlayer({ sampleRate: 24000, sinkId: outputDeviceId, onError: audioFailed });
        wavPlayerRef.current = player;
        await player.connect();
        sessionController.signal.throwIfAborted();

        const recorder = new AudioRecorder({ sampleRate: 24000, deviceId: inputDeviceId, onError: audioFailed });
        wavRecorderRef.current = recorder;
        await recorder.begin();
        sessionController.signal.throwIfAborted();

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const baseUrl = `${protocol}//${window.location.host}/api/v1/realtime?model=${encodeURIComponent(realtimeModel)}`;

        const ws = new WebSocket(baseUrl);
        wsRef.current = ws;

        const buildRecordCallback = () => (data: { mono: ArrayBuffer | null }) => {
          if (!isCurrent() || audioPausedRef.current || !data.mono?.byteLength) return;
          if (ws.readyState !== WebSocket.OPEN) return;

          if (onAudioLevel) {
            const samples = new Int16Array(data.mono);
            let sum = 0;
            for (let i = 0; i < samples.length; i++) {
              const normalized = samples[i] / 32768;
              sum += normalized * normalized;
            }
            onAudioLevel(Math.sqrt(sum / samples.length));
          }

          try {
            ws.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: base64EncodePcm16(new Int16Array(data.mono)),
              }),
            );
          } catch (error) {
            console.error("Error processing audio data:", error);
          }
        };

        const startRecording = async () => {
          if (!isCurrent() || ws.readyState !== WebSocket.OPEN) return;
          try {
            refreshRequestContext(ws);
            const callback = buildRecordCallback();
            recordCallbackRef.current = callback;
            await recorder.record(callback);
            if (isCurrent()) onReady?.();
          } catch (error) {
            console.error("Failed to start recording:", error);
            closeSession({ fatal: true, message: "Couldn't start microphone recording." });
          }
        };

        let sessionReady = false;
        let sessionReadyTimeout = window.setTimeout(() => {
          closeSession({ fatal: true, message: "The voice service did not connect. Please try again." });
        }, 15_000);
        sessionController.signal.addEventListener("abort", () => clearTimeout(sessionReadyTimeout), { once: true });

        ws.addEventListener("open", () => {
          if (sessionController.signal.aborted) return;
          console.log("WebSocket connected");

          clearTimeout(sessionReadyTimeout);
          sessionReadyTimeout = window.setTimeout(() => {
            closeSession({ fatal: true, message: "The voice service did not confirm its audio configuration." });
          }, 15_000);

          const sessionUpdate = buildSessionUpdate(transcribeModel, instructions, tools);
          ws.send(JSON.stringify(sessionUpdate));

          if (messages && messages.length > 0) {
            for (const message of messages) {
              const messageText =
                message.role === "assistant"
                  ? getFinalTextFromContent(message.content)
                  : getTextFromContent(message.content);
              if (!messageText.trim()) continue;
              ws.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "message",
                    role: message.role,
                    content: [
                      {
                        type: message.role === "user" ? "input_text" : "output_text",
                        text: messageText,
                      },
                    ],
                  },
                }),
              );
            }

            console.log("Chat history added to conversation");
          }
        });

        ws.addEventListener("message", (e) => {
          if (!isCurrent()) return;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(e.data) as Record<string, unknown>;
            if (!msg || typeof msg !== "object") throw new Error("Invalid message");
          } catch {
            closeSession({ fatal: true, message: "The voice service sent an invalid message." });
            return;
          }
          console.log("Received message:", msg.type);
          const eventWs = e.target as WebSocket;

          try {
            switch (msg.type) {
              // Only session.updated (the ack of our session.update) means the VAD/
              // transcription config is live — session.created arrives before the
              // update is applied. A missing/rejected update must not start capture.
              case "session.updated":
                if (!sessionReady) {
                  sessionReady = true;
                  clearTimeout(sessionReadyTimeout);
                  void startRecording();
                }
                break;

              case "input_audio_buffer.speech_started": {
                refreshRequestContext(eventWs);
                console.log("User started speaking, audio playback will be interrupted");
                void interruptPlayback().catch((error: unknown) => {
                  if (isCurrent())
                    audioFailed(error instanceof Error ? error : new Error("Couldn't interrupt audio playback."));
                });
                break;
              }

              case "response.created": {
                // Fallback track id for deltas that carry no response_id. Interrupted
                // track ids stay blocked so late chunks of a cancelled response never
                // splice into the next answer.
                trackIdRef.current = crypto.randomUUID();
                const createdResponseId = (msg.response as { id?: string })?.id;
                if (createdResponseId) {
                  pendingResponsesRef.current.set(createdResponseId, {
                    runId: voiceRunIdRef.current,
                    callIds: new Set(),
                    done: false,
                    hadToolCalls: false,
                  });
                }
                break;
              }

              case "conversation.item.input_audio_transcription.completed":
                console.log("Transcription completed:", msg.transcript);

                if ((msg.transcript as string)?.trim()) {
                  onUserRef.current(msg.transcript as string);
                }
                break;

              case "conversation.item.input_audio_transcription.failed":
                console.error("Transcription failed:", msg.error);
                break;

              case "response.output_audio.delta": {
                if (msg.delta) {
                  // Key playback by the delta's own response so chunks of an already
                  // interrupted response can't be tagged with the new response's track.
                  const deltaResponseId = msg.response_id as string | undefined;
                  const deltaItemId = msg.item_id as string | undefined;
                  if (deltaResponseId && deltaItemId) {
                    audioItemByResponseRef.current.set(deltaResponseId, deltaItemId);
                  }
                  playAudioChunk(msg.delta as string, wavPlayerRef.current, deltaResponseId ?? trackIdRef.current);
                }
                break;
              }

              case "response.done": {
                console.log("Response complete:", msg.response);
                const responseObj = msg.response as Record<string, unknown>;
                const responseStatus = responseObj?.status as string | undefined;
                const doneResponseId = responseObj?.id as string | undefined;
                const entry = doneResponseId ? pendingResponsesRef.current.get(doneResponseId) : undefined;
                if (!doneResponseId || !entry || entry.done) break;
                entry.done = true;
                // response.done includes every output item, including final arguments.
                // Use that snapshot for execution; no parallel delta history is needed.
                const output = (responseObj?.output as Record<string, unknown>[] | undefined) ?? [];
                const deferredCalls: DeferredToolCall[] = [];
                for (const item of output) {
                  if (item.type !== "function_call" || typeof item.call_id !== "string" || !item.call_id.trim())
                    continue;
                  if (entry.callIds.has(item.call_id)) continue;
                  entry.callIds.add(item.call_id);
                  deferredCalls.push({
                    callId: item.call_id,
                    toolName: typeof item.name === "string" ? item.name : "",
                    argsStr: typeof item.arguments === "string" ? item.arguments : "",
                    incomplete: item.status === "incomplete" || item.status === "in_progress",
                  });
                }
                entry.hadToolCalls = deferredCalls.length > 0;

                if (responseStatus === "completed") {
                  // The message item is not necessarily output[0] — tool-call responses
                  // put function_call items alongside (or before) the message.
                  const parts = output.flatMap((item) =>
                    item.type === "message" ? ((item.content as Record<string, unknown>[] | undefined) ?? []) : [],
                  );
                  const text = parts
                    .map((part) => (part?.transcript ?? part?.text) as string | undefined)
                    .filter((part): part is string => !!part)
                    .join("");
                  if (text) onAssistantRef.current(text);
                }

                if (responseStatus !== "completed") {
                  for (const deferred of deferredCalls) {
                    onToolCallDoneRef.current?.(deferred.callId);
                    // The function_call item is already committed to the conversation —
                    // give it an output so the next turn doesn't see a dangling call.
                    sendFunctionOutput(
                      eventWs,
                      deferred.callId,
                      JSON.stringify({
                        error: `The response ${responseStatus ?? "did not complete"}; the tool was not executed.`,
                      }),
                    );
                    entry.callIds.delete(deferred.callId);
                  }
                  pendingResponsesRef.current.delete(doneResponseId);
                } else {
                  if (deferredCalls.length > 0) {
                    for (const deferred of deferredCalls) {
                      void (async () => {
                        const registry = toolRegistryRef.current;
                        const tool = registry?.get(deferred.toolName);
                        const { callId, toolName, argsStr } = deferred;

                        onToolCallRef.current?.(toolName, callId);

                        let output = "";

                        let args: Record<string, unknown> | undefined;
                        try {
                          args = parseToolArguments(argsStr, toolArgumentHints(tool?.parameters));
                        } catch (parseError) {
                          console.error("Malformed tool arguments:", argsStr, parseError);
                        }

                        if (deferred.incomplete) {
                          output = JSON.stringify({
                            error:
                              "Tool arguments are incomplete; the tool was not executed. Retry with a smaller payload.",
                          });
                          onToolResultRef.current?.(toolName, callId, [{ type: "text", text: output }]);
                        } else if (args === undefined) {
                          output = JSON.stringify({
                            error: "Malformed arguments: could not parse JSON. Please retry with valid arguments.",
                          });
                          onToolResultRef.current?.(toolName, callId, [{ type: "text", text: output }]);
                        } else if (!tool) {
                          console.error(`Tool not found: ${toolName}`);
                          output = JSON.stringify({ error: `Tool "${toolName}" is not available.` });
                          onToolResultRef.current?.(toolName, callId, [{ type: "text", text: output }]);
                        } else {
                          try {
                            const ctx = {
                              ...toolContextFactoryRef.current?.({ id: callId, name: toolName }),
                              runId: entry.runId,
                              signal: sessionController.signal,
                            };
                            ctx.signal.throwIfAborted();
                            const result = await tool.function(registry!.parse(tool, args), ctx);
                            if (ctx.signal.aborted) return;
                            const rawResult =
                              typeof result === "string"
                                ? [{ type: "text" as const, text: result }]
                                : (result as (TextContent | ImageContent | AudioContent | FileContent)[]);

                            output = serializeToolResultForApi(rawResult);
                            onToolResultRef.current?.(toolName, callId, rawResult);
                          } catch (error) {
                            if (sessionController.signal.aborted) return;
                            console.error("Error executing tool:", error);
                            const errorMessage = error instanceof Error ? error.message : "Tool execution failed";
                            output = JSON.stringify({ error: errorMessage });
                            onToolResultRef.current?.(toolName, callId, [{ type: "text", text: errorMessage }]);
                          }
                        }

                        onToolCallDoneRef.current?.(callId);
                        sendFunctionOutput(eventWs, callId, output);

                        const e = pendingResponsesRef.current.get(doneResponseId);
                        if (e === entry) {
                          e.callIds.delete(callId);
                          checkAndFireResponseCreate(doneResponseId, eventWs);
                        }
                      })();
                    }
                  } else {
                    checkAndFireResponseCreate(doneResponseId, eventWs);
                    pendingResponsesRef.current.delete(doneResponseId);
                  }
                }
                drainPendingPostToolFires(eventWs);
                break;
              }

              case "error": {
                const apiError = (msg.error as Record<string, unknown>) ?? msg;
                console.error("[voice] API error:", apiError ?? msg.type);
                // Record API error so the close handler can surface it and prevent auto-restart loops.
                const code = typeof apiError?.code === "string" ? apiError.code : "";
                const message = typeof apiError?.message === "string" ? apiError.message : "";
                lastErrorRef.current = {
                  message: message || code || "The voice service reported an error.",
                  at: Date.now(),
                };
                if (!sessionReady) closeSession({ fatal: true, message: lastErrorRef.current.message });
                break;
              }
            }
          } catch (error) {
            console.error("Invalid voice service event:", error);
            closeSession({ fatal: true, message: "Couldn't process a voice service event." });
          }
        });

        ws.addEventListener("error", () => {
          closeSession({ fatal: true, message: "Couldn't connect to the voice service." });
        });

        ws.addEventListener("close", (event) => {
          console.log("WebSocket closed:", event.code, event.reason);
          clearTimeout(sessionReadyTimeout);
          // Unexpected close (user-initiated stop() flips isActiveRef first):
          // release mic/player and let the owner reset its UI state.
          if (isActiveRef.current && wsRef.current === ws) {
            console.warn("[voice] connection closed unexpectedly — stopping session");
            // A recent API error before this close means it's fatal; surface it
            // so the owner can exit realtime mode instead of auto-reconnecting.
            const recentError =
              lastErrorRef.current && Date.now() - lastErrorRef.current.at < 5000 ? lastErrorRef.current.message : null;
            const reason = recentError ? { fatal: true, message: recentError } : undefined;
            closeSession(reason);
          }
        });

        console.log("Voice session initialized, waiting for session ready...");
      } catch (error) {
        if (!isCurrent()) return;
        console.error("Failed to start voice session:", error);
        await stop();
        throw error;
      }
    },
    [stop, interruptPlayback, refreshRequestContext, checkAndFireResponseCreate, drainPendingPostToolFires],
  );

  const updateSession = useCallback(
    (tools?: Tool[], instructions?: string, toolContextFactory?: ToolContextFactory) => {
      const registry = compileToolRegistry(tools ?? []);
      toolRegistryRef.current = registry;
      if (toolContextFactory !== undefined) {
        toolContextFactoryRef.current = toolContextFactory;
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const session: Record<string, unknown> = { type: "realtime" };
      if (instructions !== undefined) session.instructions = instructions;
      // Send tools even when empty — an empty array is how stale server-side
      // tools get cleared; skipping it leaves them callable with no handler.
      if (tools !== undefined) {
        session.tools = tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }));
      }
      const update = { type: "session.update", session };
      ws.send(JSON.stringify(update));
    },
    [],
  );

  const sendText = useCallback(
    (text: string): Promise<void> => {
      const ws = wsRef.current;
      const controller = sessionControllerRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !controller) return Promise.resolve();
      // Multiple submissions while the worklet answers share one interruption and
      // one response.create; every submitted text item still reaches the conversation.
      if (pendingTextRef.current) {
        pendingTextRef.current.texts.push(text);
        return pendingTextRef.current.done;
      }
      if (hasOtherActiveResponse()) ws.send(JSON.stringify({ type: "response.cancel" }));
      const pending = { texts: [text], done: Promise.resolve() };
      pendingTextRef.current = pending;
      pendingPostToolFireRef.current = false;
      pending.done = (async () => {
        try {
          await interruptPlayback();
          if (
            controller.signal.aborted ||
            sessionControllerRef.current !== controller ||
            ws.readyState !== WebSocket.OPEN
          )
            return;
          pendingPostToolFireRef.current = false;
          refreshRequestContext(ws);
          for (const text of pending.texts) {
            ws.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "user",
                  content: [{ type: "input_text", text }],
                },
              }),
            );
          }
          ws.send(JSON.stringify({ type: "response.create" }));
        } catch (error) {
          if (!controller.signal.aborted) {
            console.error("Couldn't send voice text:", error);
            void stop();
            onClosedRef.current?.({ fatal: true, message: "Couldn't send text to the voice service." });
          }
        } finally {
          if (pendingTextRef.current === pending) pendingTextRef.current = null;
        }
      })();
      return pending.done;
    },
    [hasOtherActiveResponse, interruptPlayback, refreshRequestContext, stop],
  );

  // Clean up all resources on unmount — stop is now stable so we can use it directly
  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return { start, stop, sendText, updateSession, pauseAudio };
}

function base64EncodePcm16(samples: Int16Array): string {
  let binary = "";
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function playAudioChunk(base64: string, player: AudioStreamPlayer | null, trackId: string) {
  if (!player) {
    console.warn("No audio player available");
    return;
  }
  if (!base64) {
    console.warn("Empty audio data received");
    return;
  }
  try {
    const buf = decodeBase64(base64).buffer;
    const samples = new Int16Array(buf);
    player.add16BitPCM(samples, trackId);
  } catch (err) {
    console.error("Audio playback error:", err);
  }
}

function sendFunctionOutput(ws: WebSocket, callId: string, output: string) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output,
        },
      }),
    );
  } catch (error) {
    console.error("Failed to send function output:", error);
  }
}

function buildSessionUpdate(transcribeModel: string, instructions?: string, tools?: Tool[]) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      // No `model` here — it is selected via the ?model= query param and the
      // API rejects session.update for the model field.

      ...(instructions && { instructions }),

      truncation: {
        type: "retention_ratio",
        retention_ratio: 0.8,
        token_limits: {
          post_instructions: 8000,
        },
      },

      audio: {
        input: {
          format: {
            type: "audio/pcm",
            rate: 24000,
          },
          transcription: {
            model: transcribeModel,
          },
          noise_reduction: {
            type: "far_field",
          },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "auto",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          format: {
            type: "audio/pcm",
            rate: 24000,
          },
          voice: "alloy",
        },
      },

      ...(tools &&
        tools.length > 0 && {
          tools: tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        }),
    },
  };
}
