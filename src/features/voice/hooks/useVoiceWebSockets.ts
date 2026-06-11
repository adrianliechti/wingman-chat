import { useCallback, useEffect, useRef } from "react";
import { AudioRecorder } from "@/features/voice/lib/AudioRecorder";
import { AudioStreamPlayer } from "@/features/voice/lib/AudioStreamPlayer";
import { parseToolArguments } from "@/shared/lib/toolArguments";
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

interface DeferredToolCall {
  callId: string;
  toolName: string;
  argsStr: string;
}

interface PendingResponse {
  callIds: Set<string>;
  done: boolean;
  hadToolCalls: boolean;
  deferredToolCalls: DeferredToolCall[];
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
  onClosed?: () => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const wavPlayerRef = useRef<AudioStreamPlayer | null>(null);
  const wavRecorderRef = useRef<AudioRecorder | null>(null);
  const recordCallbackRef = useRef<((data: { mono: ArrayBuffer | null }) => void) | null>(null);
  const trackIdRef = useRef<string>(crypto.randomUUID());

  const isActiveRef = useRef(false);
  const audioPausedRef = useRef(false);

  const pendingResponsesRef = useRef<Map<string, PendingResponse>>(new Map());
  // response_id → assistant audio item_id, needed to truncate the right item
  // when the user interrupts (playback outlives response.done, so entries are
  // only cleared on stop).
  const audioItemByResponseRef = useRef<Map<string, string>>(new Map());
  const argAccumRef = useRef<Map<string, string>>(new Map());
  const pendingPostToolFireRef = useRef<boolean>(false);
  const toolsRef = useRef<Tool[] | undefined>(undefined);
  const toolContextFactoryRef = useRef<ToolContextFactory | undefined>(undefined);

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

  const pauseAudio = useCallback(async (interruptPlayback = true) => {
    if (!audioPausedRef.current) {
      audioPausedRef.current = true;
      await wavRecorderRef.current?.pause();
      // Only flush buffered playback when requested, else the assistant is cut off mid-sentence.
      if (interruptPlayback) {
        void wavPlayerRef.current?.interrupt();
      }
    }
  }, []);

  const resumeAudio = useCallback(async () => {
    if (!audioPausedRef.current) return;
    audioPausedRef.current = false;
    if (wavRecorderRef.current && recordCallbackRef.current) {
      try {
        await wavRecorderRef.current.record(recordCallbackRef.current);
      } catch {
        /* best effort */
      }
    }
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
        if (hasOtherActiveResponse()) {
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
      if (hasOtherActiveResponse()) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      pendingPostToolFireRef.current = false;
      ws.send(JSON.stringify({ type: "response.create" }));
    },
    [hasOtherActiveResponse],
  );

  const start = async (
    realtimeModel: string = "gpt-realtime-1.5",
    transcribeModel: string = "gpt-4o-mini-transcribe",
    instructions?: string,
    messages?: Message[],
    tools?: Tool[],
    inputDeviceId?: string,
    outputDeviceId?: string,
    onAudioLevel?: (level: number) => void,
    toolContextFactory?: ToolContextFactory,
  ) => {
    if (isActiveRef.current) return;
    isActiveRef.current = true;

    toolsRef.current = tools;
    toolContextFactoryRef.current = toolContextFactory;

    try {
      const player = new AudioStreamPlayer({ sampleRate: 24000, sinkId: outputDeviceId });
      await player.connect();
      wavPlayerRef.current = player;

      const recorder = new AudioRecorder({ sampleRate: 24000, deviceId: inputDeviceId });
      await recorder.begin();
      wavRecorderRef.current = recorder;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const baseUrl = `${protocol}//${window.location.host}/api/v1/realtime?model=${realtimeModel}`;

      const ws = new WebSocket(baseUrl);
      wsRef.current = ws;

      const buildRecordCallback = () => (data: { mono: ArrayBuffer | null }) => {
        if (!isActiveRef.current || audioPausedRef.current || !data.mono) return;
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

      const startRecording = () => {
        const cb = buildRecordCallback();
        recordCallbackRef.current = cb;
        recorder.record(cb).catch((error) => {
          console.error("Failed to start recording:", error);
        });
      };

      let sessionReady = false;
      let sessionReadyTimeout: number | undefined;

      ws.addEventListener("open", () => {
        console.log("WebSocket connected");

        // Fallback counts from connection open, not from connection attempt —
        // a slow connect must not start the mic against a non-open socket.
        sessionReadyTimeout = window.setTimeout(() => {
          if (!sessionReady && isActiveRef.current) {
            sessionReady = true;
            console.warn("session.updated not received within 3 s — starting recording anyway");
            startRecording();
          }
        }, 3000);

        const sessionUpdate = buildSessionUpdate(transcribeModel, instructions, tools);
        ws.send(JSON.stringify(sessionUpdate));

        if (messages && messages.length > 0) {
          const seedMessages = messages.filter((message) => {
            if (message.role !== "user" && message.role !== "assistant") return false;
            return getTextFromContent(message.content).trim().length > 0;
          });

          seedMessages.forEach((message) => {
            const messageText = getTextFromContent(message.content);
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
          });

          console.log("Chat history added to conversation");
        }
      });

      ws.addEventListener("message", async (e) => {
        const msg = JSON.parse(e.data) as Record<string, unknown>;
        console.log("Received message:", msg.type);
        const eventWs = e.target as WebSocket;

        switch (msg.type) {
          // Only session.updated (the ack of our session.update) means the VAD/
          // transcription config is live — session.created arrives before the
          // update is applied. The 3 s fallback covers a rejected update.
          case "session.updated":
            if (!sessionReady) {
              sessionReady = true;
              clearTimeout(sessionReadyTimeout);
              startRecording();
            }
            break;

          case "input_audio_buffer.speech_started": {
            console.log("User started speaking, audio playback will be interrupted");
            const player = wavPlayerRef.current;
            if (player) {
              void player.interrupt().then(({ trackId, offsetSamples, wasPlaying }) => {
                // Tell the server how much the user actually heard, otherwise the
                // conversation history keeps the full answer the model never delivered.
                if (!wasPlaying || !trackId || offsetSamples <= 0) return;
                const itemId = audioItemByResponseRef.current.get(trackId);
                if (!itemId || eventWs.readyState !== WebSocket.OPEN) return;
                eventWs.send(
                  JSON.stringify({
                    type: "conversation.item.truncate",
                    item_id: itemId,
                    content_index: 0,
                    audio_end_ms: Math.floor((offsetSamples / 24000) * 1000),
                  }),
                );
              });
            }
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
                callIds: new Set(),
                done: false,
                hadToolCalls: false,
                deferredToolCalls: [],
              });
            }
            break;
          }

          case "response.function_call_arguments.delta": {
            const deltaItemId = msg.item_id as string | undefined;
            const deltaChunk = msg.delta as string | undefined;
            if (deltaItemId && deltaChunk) {
              argAccumRef.current.set(deltaItemId, (argAccumRef.current.get(deltaItemId) ?? "") + deltaChunk);
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

          case "response.output_item.done": {
            const item = msg.item as Record<string, unknown>;
            const responseId = (msg as Record<string, unknown>).response_id as string | undefined;

            if (item?.type === "function_call") {
              const callId = item.call_id as string;
              const itemId = item.id as string;

              const accumulatedArgs = argAccumRef.current.get(itemId);
              argAccumRef.current.delete(itemId);
              const argsStr = accumulatedArgs ?? (item.arguments as string) ?? "";

              if (responseId && toolsRef.current) {
                const entry = pendingResponsesRef.current.get(responseId);
                if (entry) {
                  entry.hadToolCalls = true;
                  entry.callIds.add(callId);
                  entry.deferredToolCalls.push({ callId, toolName: item.name as string, argsStr });
                } else {
                  console.warn(`[voice:tool] no pending entry for response ${responseId} — cannot defer tool call`);
                }
              }
            }
            break;
          }

          case "response.done": {
            console.log("Response complete:", msg.response);
            const responseObj = msg.response as Record<string, unknown>;
            const responseStatus = responseObj?.status as string | undefined;

            if (responseStatus !== "cancelled") {
              // The message item is not necessarily output[0] — tool-call responses
              // put function_call items alongside (or before) the message.
              const output = responseObj?.output as Record<string, unknown>[] | undefined;
              const messageItem = output?.find((item) => item?.type === "message");
              const parts = (messageItem?.content as Record<string, unknown>[] | undefined) ?? [];
              const text = parts
                .map((part) => (part?.transcript ?? part?.text) as string | undefined)
                .filter((part): part is string => !!part)
                .join("");
              if (text) onAssistantRef.current(text);
            }

            const doneResponseId = responseObj?.id as string | undefined;
            if (doneResponseId) {
              const entry = pendingResponsesRef.current.get(doneResponseId);
              if (entry) {
                const deferredCalls = entry.deferredToolCalls;
                entry.deferredToolCalls = [];

                if (responseStatus === "cancelled" && deferredCalls.length > 0) {
                  for (const deferred of deferredCalls) {
                    onToolCallDoneRef.current?.(deferred.callId);
                    // The function_call item is already committed to the conversation —
                    // give it an output so the next turn doesn't see a dangling call.
                    sendFunctionOutput(
                      eventWs,
                      deferred.callId,
                      JSON.stringify({ error: "Cancelled: the user interrupted before the tool ran." }),
                    );
                    entry.callIds.delete(deferred.callId);
                  }
                  pendingResponsesRef.current.delete(doneResponseId);
                } else {
                  entry.done = true;

                  if (deferredCalls.length > 0) {
                    for (const deferred of deferredCalls) {
                      void (async () => {
                        const tool = toolsRef.current?.find((t) => t.name === deferred.toolName);
                        const { callId, toolName, argsStr } = deferred;

                        onToolCallRef.current?.(toolName, callId);

                        let output = "";

                        let args: Record<string, unknown> | undefined;
                        try {
                          args = parseToolArguments(argsStr);
                        } catch (parseError) {
                          console.error("Malformed tool arguments:", argsStr, parseError);
                        }

                        if (args === undefined) {
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
                            const ctx = toolContextFactoryRef.current?.({ id: callId, name: toolName });
                            const result = await tool.function(args, ctx);
                            const rawResult =
                              typeof result === "string"
                                ? [{ type: "text" as const, text: result }]
                                : (result as (TextContent | ImageContent | AudioContent | FileContent)[]);

                            output = serializeToolResultForApi(rawResult);
                            onToolResultRef.current?.(toolName, callId, rawResult);
                          } catch (error) {
                            console.error("Error executing tool:", error);
                            const errorMessage = error instanceof Error ? error.message : "Tool execution failed";
                            output = JSON.stringify({ error: errorMessage });
                            onToolResultRef.current?.(toolName, callId, [{ type: "text", text: errorMessage }]);
                          }
                        }

                        onToolCallDoneRef.current?.(callId);
                        sendFunctionOutput(eventWs, callId, output);

                        const e = pendingResponsesRef.current.get(doneResponseId);
                        if (e) {
                          e.callIds.delete(callId);
                          checkAndFireResponseCreate(doneResponseId, eventWs);
                        } else {
                          console.warn(
                            `[voice:tool] response entry for ${doneResponseId} missing after tool completion — sending response.create directly`,
                          );
                          if (eventWs.readyState === WebSocket.OPEN) {
                            eventWs.send(JSON.stringify({ type: "response.create" }));
                          }
                        }
                      })();
                    }
                  } else {
                    checkAndFireResponseCreate(doneResponseId, eventWs);
                    pendingResponsesRef.current.delete(doneResponseId);
                  }
                }
              }
            }
            drainPendingPostToolFires(eventWs);
            break;
          }

          case "error":
            console.error("[voice] API error:", (msg.error as Record<string, unknown>) ?? msg.type);
            break;
        }
      });

      ws.addEventListener("error", (error) => {
        console.error("WebSocket error:", error);
      });

      ws.addEventListener("close", (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
        clearTimeout(sessionReadyTimeout);
        // Unexpected close (user-initiated stop() flips isActiveRef first):
        // release mic/player and let the owner reset its UI state.
        if (isActiveRef.current && wsRef.current === ws) {
          console.warn("[voice] connection closed unexpectedly — stopping session");
          void stop().finally(() => onClosedRef.current?.());
        }
      });

      console.log("Voice session initialized, waiting for session ready...");
    } catch (error) {
      console.error("Failed to start voice session:", error);
      await stop();
      throw error;
    }
  };

  const updateSession = useCallback(
    (tools?: Tool[], instructions?: string, toolContextFactory?: ToolContextFactory) => {
      toolsRef.current = tools;
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

  // stop only reads/writes refs → stable with useCallback([])
  const stop = useCallback(async () => {
    isActiveRef.current = false;
    audioPausedRef.current = false;

    pendingResponsesRef.current.clear();
    audioItemByResponseRef.current.clear();
    argAccumRef.current.clear();
    pendingPostToolFireRef.current = false;

    // Stop recorder
    if (wavRecorderRef.current) {
      try {
        await wavRecorderRef.current.end();
      } catch {
        try {
          await wavRecorderRef.current?.pause();
        } catch {
          /* best effort */
        }
      }
      wavRecorderRef.current = null;
    }
    recordCallbackRef.current = null;

    // Close WebSocket
    const ws = wsRef.current;
    if (ws) {
      try {
        // Also close while CONNECTING — otherwise the socket finishes the
        // handshake later and lives on as a zombie session.
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "User stopped session");
        }
      } catch {
        /* best effort */
      }
      wsRef.current = null;
    }

    // Stop audio player
    if (wavPlayerRef.current) {
      try {
        wavPlayerRef.current.disconnect();
      } catch {
        /* best effort */
      }
      wavPlayerRef.current = null;
    }
  }, []); // all state accessed via refs — no deps needed

  // sendText only reads refs → stable deps
  const sendText = useCallback(
    (text: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      // response.create while another response is active is rejected by the
      // server — cancel the active one first (mirrors a spoken interruption).
      if (hasOtherActiveResponse()) {
        ws.send(JSON.stringify({ type: "response.cancel" }));
        void wavPlayerRef.current?.interrupt();
      }
      // The explicit response.create below also answers any finished tool
      // calls, so a queued post-tool fire would just double-respond.
      pendingPostToolFireRef.current = false;

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

      ws.send(JSON.stringify({ type: "response.create" }));
    },
    [hasOtherActiveResponse],
  );

  // Clean up all resources on unmount — stop is now stable so we can use it directly
  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return { start, stop, sendText, updateSession, pauseAudio, resumeAudio };
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
