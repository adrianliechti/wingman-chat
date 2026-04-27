import { useCallback, useEffect, useRef } from "react";
import { AudioRecorder } from "@/features/voice/lib/AudioRecorder";
import { AudioStreamPlayer } from "@/features/voice/lib/AudioStreamPlayer";
import { decodeBase64, serializeToolResultForApi } from "@/shared/lib/utils";
import type { AudioContent, FileContent, ImageContent, Message, TextContent, Tool } from "@/shared/types/chat";
import { getTextFromContent } from "@/shared/types/chat";

export function useVoiceWebSockets(
  onUser: (text: string) => void,
  onAssistant: (text: string) => void,
  onToolCall?: (toolName: string) => void,
  onToolCallDone?: () => void,
  onToolResult?: (
    toolName: string,
    callId: string,
    result: (TextContent | ImageContent | AudioContent | FileContent)[],
  ) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const wavPlayerRef = useRef<AudioStreamPlayer | null>(null);
  const wavRecorderRef = useRef<AudioRecorder | null>(null);
  // current track ID for audio playback; bump after interrupt to allow restart
  const trackIdRef = useRef<string>(crypto.randomUUID());

  const isActiveRef = useRef(false);

  // Use refs to always have the latest callbacks
  const onUserRef = useRef(onUser);
  const onAssistantRef = useRef(onAssistant);
  const onToolCallRef = useRef(onToolCall);
  const onToolCallDoneRef = useRef(onToolCallDone);
  const onToolResultRef = useRef(onToolResult);

  // Keep refs updated with latest callbacks
  useEffect(() => {
    onUserRef.current = onUser;
    onAssistantRef.current = onAssistant;
    onToolCallRef.current = onToolCall;
    onToolCallDoneRef.current = onToolCallDone;
    onToolResultRef.current = onToolResult;
  }, [onUser, onAssistant, onToolCall, onToolCallDone, onToolResult]);

  const start = async (
    realtimeModel: string = "gpt-realtime-1.5",
    transcribeModel: string = "gpt-4o-mini-transcribe",
    instructions?: string,
    messages?: Message[],
    tools?: Tool[],
    inputDeviceId?: string,
    outputDeviceId?: string,
    onAudioLevel?: (level: number) => void,
  ) => {
    if (isActiveRef.current) return;
    isActiveRef.current = true;

    try {
      // Initialize AudioStreamPlayer for audio playback
      const player = new AudioStreamPlayer({ sampleRate: 24000, sinkId: outputDeviceId });
      await player.connect();
      wavPlayerRef.current = player;

      // Initialize AudioRecorder for audio input
      const recorder = new AudioRecorder({ sampleRate: 24000, deviceId: inputDeviceId });
      await recorder.begin();
      wavRecorderRef.current = recorder;

      // Use relative path for WebSocket connection
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const baseUrl = `${protocol}//${window.location.host}/api/v1/realtime?model=${realtimeModel}`;

      const ws = new WebSocket(baseUrl);

      wsRef.current = ws;

      ws.addEventListener("open", () => {
        console.log("WebSocket connected");

        // Send session configuration
        const sessionUpdate = {
          type: "session.update",
          session: {
            type: "realtime",
            model: realtimeModel,

            ...(instructions && { instructions: instructions }),

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

        ws.send(JSON.stringify(sessionUpdate));

        if (messages && messages.length > 0) {
          // Only seed user/assistant text messages — tool_call, tool_result, and
          const seedMessages = messages.filter((message) => {
            if (message.role !== "user" && message.role !== "assistant") return false;
            return getTextFromContent(message.content).trim().length > 0;
          });

          seedMessages.forEach((message) => {
            const messageText = getTextFromContent(message.content);
            const conversationItem = {
              type: "conversation.item.create",
              item: {
                type: "message",
                role: message.role,
                content: [
                  {
                    type: message.role === "user" ? "input_text" : "text",
                    text: messageText,
                  },
                ],
              },
            };

            ws.send(JSON.stringify(conversationItem));
          });

          console.log("Chat history added to conversation");
        }

        // Start recording immediately after WebSocket connects
        console.log("Starting audio recording after WebSocket connection...");
        recorder
          .record((data) => {
            if (!isActiveRef.current || !data.mono) return;

            // Compute RMS audio level from PCM samples
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
          })
          .catch((error) => {
            console.error("Failed to start recording:", error);
          });
      });

      ws.addEventListener("message", async (e) => {
        const msg = JSON.parse(e.data);
        console.log("Received message:", msg.type);
        const eventWs = e.target as WebSocket;

        switch (msg.type) {
          case "input_audio_buffer.speech_started":
            console.log("User started speaking, audio playback will be interrupted");
            wavPlayerRef.current?.interrupt();
            break;

          case "response.created":
            // Reset track ID and clear interrupt state so the new response's
            // audio deltas are accepted. Deltas arriving between speech_started
            // and response.created belong to the old (cancelled) response and
            // remain blocked by the interrupted trackId.
            trackIdRef.current = crypto.randomUUID();
            wavPlayerRef.current?.clearInterrupts();
            break;

          case "conversation.item.input_audio_transcription.completed":
            console.log("Transcription completed:", msg.transcript);

            if (msg.transcript?.trim()) {
              onUserRef.current(msg.transcript);
            }
            break;

          case "conversation.item.input_audio_transcription.failed":
            console.error("Transcription failed:", msg.error);
            //onUser('Input Transcription failed');
            break;

          case "response.output_audio.delta":
            if (msg.delta) {
              playAudioChunk(msg.delta);
            }

            break;

          case "response.output_item.done":
            console.log("Response output item done:", msg.item);

            // Handle function calls
            if (msg.item?.type === "function_call" && tools) {
              const tool = tools.find((t) => t.name === msg.item.name);
              if (tool && msg.item.arguments) {
                console.log(`Executing tool: ${tool.name} with arguments:`, msg.item.arguments);

                onToolCallRef.current?.(tool.name);

                let output: string;

                try {
                  const args = JSON.parse(msg.item.arguments);
                  const result = await tool.function(args);
                  // Serialize result, stripping binary data from images/audio/files
                  const rawResult =
                    typeof result === "string"
                      ? [{ type: "text" as const, text: result }]
                      : (result as (TextContent | ImageContent | AudioContent | FileContent)[]);
                  output = serializeToolResultForApi(rawResult);
                  // Notify caller with the raw result so rich content (images etc.) can be shown in chat
                  onToolResultRef.current?.(tool.name, msg.item.call_id, rawResult);
                  console.log("Function result:", result);
                } catch (error) {
                  console.error("Error executing tool:", error);
                  const errorMessage = error instanceof Error ? error.message : "Tool execution failed";
                  output = JSON.stringify({ error: errorMessage });
                } finally {
                  onToolCallDoneRef.current?.();
                }

                // Send the function result back to the conversation
                const functionOutput = {
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: msg.item.call_id,
                    output: output,
                  },
                };

                // Best effort - try to send without checking state
                try {
                  eventWs.send(JSON.stringify(functionOutput));
                  console.log("Function output sent:", output);

                  // Trigger response generation after sending function result
                  eventWs.send(
                    JSON.stringify({
                      type: "response.create",
                    }),
                  );
                } catch (error) {
                  console.error("Failed to send function output:", error);
                }
              } else if (!tool) {
                console.error(`Tool not found: ${msg.item.name}`);
              }
            }
            break;

          case "response.done": {
            console.log("Response complete:", msg.response);
            const output = msg.response?.output?.[0]?.content?.[0];
            const text = output?.transcript ?? output?.text;
            if (text) onAssistantRef.current(text);
            break;
          }

          case "error":
            console.error("OpenAI Error:", msg.error);
            break;
        }
      });

      ws.addEventListener("error", (error) => {
        console.error("WebSocket error:", error);
      });

      ws.addEventListener("close", (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
      });

      console.log("Voice session initialized, waiting for session ready...");
    } catch (error) {
      console.error("Failed to start voice session:", error);
      // Clean up on error
      await stop();
      throw error;
    }
  };

  // stop only reads/writes refs → stable with useCallback([])
  const stop = useCallback(async () => {
    isActiveRef.current = false;

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

    // Close WebSocket
    const ws = wsRef.current;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close(1000, "User stopped session");
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

  // Encode Int16 PCM samples directly to base64
  const base64EncodePcm16 = (samples: Int16Array) => {
    let binary = "";
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    const chunkSize = 0x8000; // 32KB chunk size
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  };

  const playAudioChunk = (base64: string) => {
    const player = wavPlayerRef.current;
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
      // use a fresh trackId after interrupts to allow restarting playback
      player.add16BitPCM(samples, trackIdRef.current);
    } catch (err) {
      console.error("Audio playback error:", err);
    }
  };

  // sendText only reads refs → stable with useCallback([])
  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // all state accessed via refs — no deps needed

  // Clean up all resources on unmount — stop is now stable so we can use it directly
  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return { start, stop, sendText };
}
