import { useRef } from 'react';
import { WavStreamPlayer, WavRecorder } from 'wavtools';

/**
 * Hook to manage OpenAI Realtime voice streaming via WebSockets with PCM16.
 */
export function useRealtimeVoice(
  onUser: (text: string) => void,
  onAssistant: (text: string) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const wavPlayerRef = useRef<WavStreamPlayer | null>(null);
  const wavRecorderRef = useRef<WavRecorder | null>(null);
  const isActiveRef = useRef(false);
  const isConnectedRef = useRef(false);
  const isRecordingRef = useRef(false);

  // TODO: secure your API key via backend proxy

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
      player.add16BitPCM(samples, 'assistant');
    } catch (err) {
      console.error('Audio playback error:', err);
    }
  };

  const start = async () => {
    if (isActiveRef.current) return;
    
    try {
      // Reset recording state
      isRecordingRef.current = false;
      
      // Check microphone permissions first
      console.log('Checking microphone permissions...');
      try {
        const permissions = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        console.log('Microphone permission state:', permissions.state);
      } catch (permError) {
        console.log('Permission check failed (may not be supported):', permError);
      }
      
      // Initialize WavStreamPlayer for audio playback
      const player = new WavStreamPlayer({ sampleRate: 24000 });
      await player.connect();
      wavPlayerRef.current = player;

      // Initialize WavRecorder for audio input
      const recorder = new WavRecorder({ sampleRate: 24000 });
      await recorder.begin();
      wavRecorderRef.current = recorder;
      
      console.log('Recorder initialized, status:', recorder.getStatus());
      console.log('Recorder sample rate:', recorder.getSampleRate());

      const model = "gpt-4o-realtime-preview-2024-12-17";
      const ws = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${model}`,
        [
          "realtime",
          "openai-insecure-api-key." + OPENAI_API_KEY,
          "openai-beta.realtime-v1"
        ]
      );
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        console.log('WebSocket connected');
        isConnectedRef.current = true;
        
        // Send session configuration
        const sessionUpdate = {
          type: 'session.update',
          session: {
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { 
              model: 'whisper-1' 
            },
          }
        };
        
        ws.send(JSON.stringify(sessionUpdate));
        
        // Start recording immediately after WebSocket connects
        console.log('Starting audio recording after WebSocket connection...');
        if (!isRecordingRef.current && recorder.getStatus() === 'paused') {
          isRecordingRef.current = true;
          recorder.record((data) => {
            const { mono, raw } = data;
            
            // Handle ArrayBuffer data properly
            const monoArray = mono ? new Int16Array(mono) : null;
            const rawArray = raw ? new Int16Array(raw) : null;
            
            console.log('Audio data received:', {
              monoLength: monoArray?.length,
              rawLength: rawArray?.length,
              wsState: ws.readyState,
              isConnected: isConnectedRef.current
            });
            
            if (ws.readyState === WebSocket.OPEN && monoArray && isConnectedRef.current) {
              try {
                // Convert Int16Array audio data to base64 PCM16
                const float32Array = new Float32Array(monoArray.length);
                for (let i = 0; i < monoArray.length; i++) {
                  float32Array[i] = monoArray[i] / (monoArray[i] < 0 ? 0x8000 : 0x7fff);
                }
                const audio = base64EncodeAudio(float32Array);
                
                if (audio) {
                  console.log('Sending audio chunk, length:', audio.length);
                  ws.send(JSON.stringify({ 
                    type: 'input_audio_buffer.append', 
                    audio 
                  }));
                }
              } catch (error) {
                console.error('Error processing audio data:', error);
              }
            } else {
              console.warn('Cannot send audio:', {
                wsState: ws.readyState,
                hasMono: !!monoArray,
                isConnected: isConnectedRef.current
              });
            }
          }).catch(error => {
            console.error('Failed to start recording:', error);
            isRecordingRef.current = false;
          });
        } else {
          console.log('Recording already active or recorder not ready. Status:', recorder.getStatus());
        }
      });

      ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        console.log('Received message:', msg.type);
        
        switch (msg.type) {
          case 'session.created':
          case 'session.updated':
            console.log('Session ready');
            break;
          case 'conversation.item.input_audio_transcription.completed':
            console.log('Transcription completed:', msg.transcript);
            if (msg.transcript?.trim()) {
              onUser(msg.transcript);
            }
            break;
          case 'response.audio.delta':
            if (msg.delta) {
              playAudioChunk(msg.delta);
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
        isConnectedRef.current = false;
      });

      ws.addEventListener('close', (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        isConnectedRef.current = false;
      });

      isActiveRef.current = true;
      console.log('Voice session initialized, waiting for session ready...');
    } catch (error) {
      console.error('Failed to start voice session:', error);
      throw error;
    }
  };

  const stop = () => {
    console.log('Stopping voice session...');
    
    // Stop recorder
    if (wavRecorderRef.current) {
      try {
        if (isRecordingRef.current) {
          wavRecorderRef.current.pause();
          isRecordingRef.current = false;
        }
      } catch (error) {
        console.error('Error pausing recorder:', error);
      }
      wavRecorderRef.current = null;
    }

    // Close WebSocket
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000, 'User stopped session');
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
    }
    wsRef.current = null;
    isConnectedRef.current = false;

    // Stop audio player
    if (wavPlayerRef.current) {
      try {
        wavPlayerRef.current.interrupt();
      } catch (error) {
        console.error('Error interrupting player:', error);
      }
      wavPlayerRef.current = null;
    }

    isActiveRef.current = false;
    console.log('Voice session stopped');
  };

  const setInstructions = (instructions: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && isConnectedRef.current) {
      ws.send(JSON.stringify({ 
        type: 'session.update', 
        session: { instructions } 
      }));
      console.log('Instructions updated:', instructions);
    } else {
      console.warn('Cannot set instructions: WebSocket not connected');
    }
  };

  const setVoice = (voice: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && isConnectedRef.current) {
      ws.send(JSON.stringify({ 
        type: 'session.update', 
        session: { voice } 
      }));
      console.log('Voice updated:', voice);
    } else {
      console.warn('Cannot set voice: WebSocket not connected');
    }
  };

  return { start, stop, setInstructions, setVoice };
}
