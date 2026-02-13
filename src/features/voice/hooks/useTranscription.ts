import { useState, useCallback, useRef } from 'react';
import { getConfig } from '@/shared/config';
import { AudioRecorder } from '@/features/voice/lib/AudioRecorder';
import { pcm16ToWav, mergePcm16Chunks } from '@/features/voice/lib/audio';

export interface UseTranscriptionReturn {
  canTranscribe: boolean;
  isTranscribing: boolean;
  startTranscription: () => Promise<void>;
  stopTranscription: () => Promise<string>;
}

export function useTranscription(): UseTranscriptionReturn {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const pcmChunksRef = useRef<Int16Array[]>([]);

  // Check if transcription is available
  const config = getConfig();
  const canTranscribe = !!config.stt && 
    typeof navigator !== 'undefined' && 
    navigator.mediaDevices && 
    typeof navigator.mediaDevices.getUserMedia === 'function';

  const startTranscription = useCallback(async () => {
    if (!canTranscribe) {
      throw new Error('Transcription is not available');
    }
    
    try {
      // Clear previous audio chunks
      pcmChunksRef.current = [];
      
      // Create and start AudioRecorder
      const recorder = new AudioRecorder({ sampleRate: 24000 });
      await recorder.begin();
      await recorder.record((chunk) => {
        pcmChunksRef.current.push(new Int16Array(chunk.mono));
      });
      
      audioRecorderRef.current = recorder;
      setIsTranscribing(true);
      
    } catch (err) {
      console.error('Failed to start transcription:', err);
    }
  }, [canTranscribe]);

  const stopTranscription = useCallback(async (): Promise<string> => {
    const recorder = audioRecorderRef.current;
    
    if (!recorder) {
      throw new Error('No active recording to stop');
    }
    
    try {
      // Stop recording
      await recorder.end();
      audioRecorderRef.current = null;
      setIsTranscribing(false);
      
      // Convert PCM chunks to WAV
      const chunks = pcmChunksRef.current;
      if (chunks.length === 0) {
        throw new Error('No audio recorded');
      }
      
      const merged = mergePcm16Chunks(chunks);
      const audioBlob = pcm16ToWav(merged, 24000);
      pcmChunksRef.current = [];
      
      // Send to transcription API with model from config
      const config = getConfig();
      const model = config.stt?.model ?? "";
      const transcribedText = await config.client.transcribe(model, audioBlob);
      
      return transcribedText;
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to transcribe audio';
      throw new Error(errorMessage);
    }
  }, []);

  return {
    canTranscribe,
    isTranscribing,
    startTranscription,
    stopTranscription,
  };
}
