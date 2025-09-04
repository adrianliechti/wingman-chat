import { useRef } from 'react';
import { WavStreamPlayer, WavRecorder } from 'wavtools';
import { AttachmentType } from '../types/chat';
import type { Message, Tool } from '../types/chat';

/**
 * Hook to manage OpenAI Realtime voice streaming via WebSockets with PCM16.
 */
export function useVoiceWebSockets(
  onUser: (text: string) => void,
  onAssistant: (text: string) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const wavPlayerRef = useRef<WavStreamPlayer | null>(null);
  const wavRecorderRef = useRef<WavRecorder | null>(null);
  // current track ID for audio playback; bump after interrupt to allow restart
  const trackIdRef = useRef<string>(crypto.randomUUID());

  const isActiveRef = useRef(false);

  const start = async (
    realtimeModel: string = "gpt-realtime",
    transcribeModel: string = "gpt-4o-transcribe",
    instructions?: string,
    messages?: Message[],
    tools?: Tool[]
  ) => {
    if (isActiveRef.current) return;
    isActiveRef.current = true;

    try {
      // Initialize WavStreamPlayer for audio playback
      const player = new WavStreamPlayer({ sampleRate: 24000 });
      await player.connect();
      wavPlayerRef.current = player;

      // Initialize WavRecorder for audio input
      const recorder = new WavRecorder({ sampleRate: 24000 });
      await recorder.begin();
      wavRecorderRef.current = recorder;

      // Use relative path for WebSocket connection
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const baseUrl = `${protocol}//${window.location.host}/api/v1/realtime?model=${realtimeModel}`;

      const ws = new WebSocket(baseUrl);

      wsRef.current = ws;

      ws.addEventListener('open', () => {
        console.log('WebSocket connected');

        // Send session configuration
        const sessionUpdate = {
          type: 'session.update',
          session: {
            type: 'realtime',
            model: realtimeModel,

            ...(instructions && { instructions: instructions }),

            audio: {
              input: {
                format: {
                  type: 'audio/pcm',
                  rate: 24000,
                },

                noise_reduction: {
                  type: 'near_field'
                },

                turn_detection: {
                  type: 'server_vad',
                  create_response: true,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 700,
                  threshold: 0.7,
                },

                transcription: {
                  model: transcribeModel,
                }
              },

              output: {
                format: {
                  type: 'audio/pcm',
                  rate: 24000,
                },

                voice: 'alloy',
              }
            },

            ...(tools && tools.length > 0 && {
              tools: tools.map(tool => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
              }))
            })
          }
        };

        ws.send(JSON.stringify(sessionUpdate));

        if (messages && messages.length > 0) {
          console.log(`Adding ${messages.length} messages to conversation history`);

          messages.forEach((message) => {
            const content: Array<{
              type: 'input_text' | 'text';
              text: string;
            }> = [];

            // Add main message content
            if (message.content) {
              content.push({
                type: message.role === 'user' ? 'input_text' : 'text',
                text: message.content
              });
            }

            // Add text attachments
            if (message.attachments) {
              message.attachments
                .filter(a => a.type === AttachmentType.Text)
                .forEach(attachment => {
                  content.push({
                    type: message.role === 'user' ? 'input_text' : 'text',
                    text: `// ${attachment.name}\n${attachment.data}`
                  });
                });
            }

            const conversationItem = {
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: message.role,
                content: content
              }
            };

            ws.send(JSON.stringify(conversationItem));
          });

          console.log('Chat history added to conversation');
        }

        // Start recording immediately after WebSocket connects
        console.log('Starting audio recording after WebSocket connection...');
        recorder.record((data) => {
          // Check if session is still active first
          if (!isActiveRef.current) {
            return;
          }

          const { mono } = data;

          // Handle ArrayBuffer data properly
          const monoArray = mono ? new Int16Array(mono) : null;

          if (monoArray && isActiveRef.current) {
            try {
              // Convert Int16Array audio data to base64 PCM16
              const float32Array = new Float32Array(monoArray.length);

              for (let i = 0; i < monoArray.length; i++) {
                float32Array[i] = monoArray[i] / (monoArray[i] < 0 ? 0x8000 : 0x7fff);
              }
              const audio = base64EncodeAudio(float32Array);

              if (audio && isActiveRef.current) {
                ws.send(JSON.stringify({
                  type: 'input_audio_buffer.append',
                  audio: audio
                }));
              }
            } catch (error) {
              console.error('Error processing audio data:', error);
            }
          }
          // Remove the warning log to reduce noise when session is properly stopped
        }).catch(error => {
          console.error('Failed to start recording:', error);
        });
      });

      ws.addEventListener('message', async (e) => {
        const msg = JSON.parse(e.data);
        console.log('Received message:', msg.type);
        const eventWs = e.target as WebSocket;

        switch (msg.type) {
          case 'input_audio_buffer.speech_started':
            console.log('User started speaking, audio playback will be interrupted');
            wavPlayerRef.current?.interrupt();
            break;

          case 'input_audio_buffer.speech_stopped':
            console.log('User stopped speaking, audio playback can resume');
            // reset track ID so that subsequent add16BitPCM restarts playback
            trackIdRef.current = crypto.randomUUID();
            break;

          case 'conversation.item.input_audio_transcription.delta':
            break;

          case 'conversation.item.input_audio_transcription.completed':
            console.log('Transcription completed:', msg.transcript);

            if (msg.transcript?.trim()) {
              onUser(msg.transcript);
            }
            break;

          case 'conversation.item.input_audio_transcription.failed':
            console.error('Transcription failed:', msg.error);
            onUser('Input Transcription failed');
            break;

          case 'response.output_audio.delta':
            if (msg.delta) {
              playAudioChunk(msg.delta);
            }

            break;

          case 'response.output_item.done':
            console.log('Response output item done:', msg.item);

            // Handle function calls
            if (msg.item?.type === 'function_call' && tools) {
              const tool = tools.find(t => t.name === msg.item.name);
              if (tool && msg.item.arguments) {
                console.log(`Executing tool: ${tool.name} with arguments:`, msg.item.arguments);

                let output: string;

                try {
                  const args = JSON.parse(msg.item.arguments);
                  const result = await tool.function(args);
                  output = result;
                  console.log('Function result:', result);
                } catch (error) {
                  console.error('Error executing tool:', error);
                  const errorMessage = error instanceof Error ? error.message : 'Tool execution failed';
                  output = JSON.stringify({ error: errorMessage });
                }

                // Send the function result back to the conversation
                const functionOutput = {
                  type: 'conversation.item.create',
                  item: {
                    type: 'function_call_output',
                    call_id: msg.item.call_id,
                    output: output
                  }
                };

                // Best effort - try to send without checking state
                try {
                  eventWs.send(JSON.stringify(functionOutput));
                  console.log('Function output sent:', output);

                  // Trigger response generation after sending function result
                  eventWs.send(JSON.stringify({
                    type: 'response.create'
                  }));
                } catch (error) {
                  console.error('Failed to send function output:', error);
                }
              } else if (!tool) {
                console.error(`Tool not found: ${msg.item.name}`);
              }
            }
            break;

          case 'response.done':
            console.log('Response complete:', msg.response);

            if (msg.response?.output?.[0]?.content?.[0]?.transcript) {
              onAssistant(msg.response.output[0].content[0].transcript);
            }
            break;

          case 'error':
            console.error('OpenAI Error:', msg.error);
            break;
        }
      });

      ws.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
      });

      ws.addEventListener('close', (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
      });

      console.log('Voice session initialized, waiting for session ready...');
    } catch (error) {
      console.error('Failed to start voice session:', error);
      // Clean up on error
      await stop();
      throw error;
    }
  };

  const stop = async () => {
    console.log('Stopping voice session...');

    // First, set the active flag to false to prevent any new audio processing
    isActiveRef.current = false;

    // Stop recorder
    if (wavRecorderRef.current) {
      try {
        console.log('Stopping audio recorder...');

        // End the recording session
        await wavRecorderRef.current.end();
        wavRecorderRef.current = null;
      } catch (error) {
        console.error('Error stopping recorder:', error);
        // Force cleanup even if end() fails
        try {
          if (wavRecorderRef.current) {
            await wavRecorderRef.current.pause();
          }
        } catch (pauseError) {
          console.error('Error pausing recorder during cleanup:', pauseError);
        }
        wavRecorderRef.current = null;
      }
    }

    // Close WebSocket
    const ws = wsRef.current;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          console.log('Closing WebSocket connection...');
          ws.close(1000, 'User stopped session');
        }
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
      wsRef.current = null;
    }

    // Stop audio player
    if (wavPlayerRef.current) {
      try {
        console.log('Stopping audio player...');
        wavPlayerRef.current.interrupt();
      } catch (error) {
        console.error('Error interrupting player:', error);
      }
      wavPlayerRef.current = null;
    }

    console.log('Voice session stopped');
  };



  // Convert Float32Array of audio data to base64-encoded PCM16
  const floatTo16BitPCM = (float32Array: Float32Array) => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  };

  const base64EncodeAudio = (float32Array: Float32Array) => {
    const arrayBuffer = floatTo16BitPCM(float32Array);
    let binary = '';
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000; // 32KB chunk size
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  };

  const base64ToArrayBuffer = (base64: string) => {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };

  const playAudioChunk = (base64: string) => {
    const player = wavPlayerRef.current;
    if (!player) {
      console.warn('No audio player available');
      return;
    }

    if (!base64) {
      console.warn('Empty audio data received');
      return;
    }

    try {
      const buf = base64ToArrayBuffer(base64);
      const samples = new Int16Array(buf);
      // use a fresh trackId after interrupts to allow restarting playback
      player.add16BitPCM(samples, trackIdRef.current);
    } catch (err) {
      console.error('Audio playback error:', err);
    }
  };

  return { start, stop };
}