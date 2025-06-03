import { useRef } from 'react';

/**
 * Hook to manage OpenAI Realtime voice streaming via WebSockets with PCM16.
 */
export function useRealtimeVoice(
  onUser: (text: string) => void,
  onAssistant: (text: string) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const isActiveRef = useRef(false);

  // TODO: secure your API key via backend proxy

  // Helpers for audio data conversion
  const float32ToPCM16 = (input: Float32Array) => {
    const pcm16 = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm16[i] = s * 0x7fff;
    }
    return pcm16.buffer;
  };
  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
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
    const buf = base64ToArrayBuffer(base64);
    const blob = new Blob([buf], { type: 'audio/pcm' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().catch(console.error);
  };

  const start = async () => {
    if (isActiveRef.current) return;
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
      // Initialize session with desired settings
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: '',
          voice: 'alloy',  // default voice
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' }
        }
      }));
    });
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'conversation.item.input_audio_transcription.completed':
          onUser(msg.transcript || '');
          break;
        case 'response.text': // optional if text responses
          onAssistant(msg.text || '');
          break;
        case 'response.audio.delta':
          playAudioChunk(msg.delta);
          break;
        case 'response.audio.done':
          break;
      }
    });
    ws.addEventListener('error', console.error);
    ws.addEventListener('close', () => console.log('WS closed'));

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    const audioContext = new AudioContext({ sampleRate: 24000 });
    audioContextRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    processor.onaudioprocess = (evt) => {
      if (ws.readyState === WebSocket.OPEN) {
        const pcm = float32ToPCM16(evt.inputBuffer.getChannelData(0));
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: arrayBufferToBase64(pcm) }));
      }
    };
    source.connect(processor);
    processor.connect(audioContext.destination);

    isActiveRef.current = true;
  };

  const stop = () => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      ws.send(JSON.stringify({
        type: 'response.create',
        response: { modalities: ['text', 'audio'], instructions: '' }
      }));
      ws.close();
    }
    wsRef.current = null;
    isActiveRef.current = false;
  };

  const setInstructions = (instructions: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'session.update', session: { instructions } }));
    }
  };

  const setVoice = (voice: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'session.update', session: { voice } }));
    }
  };

  return { start, stop, setInstructions, setVoice };
}
