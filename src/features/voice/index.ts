// Components
export { VoiceWaves } from './components/VoiceWaves';

// Context
export { VoiceContext } from './context/VoiceContext';
export type { VoiceContextType } from './context/VoiceContext';
export { VoiceProvider } from './context/VoiceProvider';

// Hooks
export { useVoice } from './hooks/useVoice';
export { useTranscription } from './hooks/useTranscription';
export type { UseTranscriptionReturn } from './hooks/useTranscription';
export { useVoiceWebSockets } from './hooks/useVoiceWebSockets';

// Lib
export { AudioPlayer } from './lib/AudioPlayer';
export type { AudioPlayerOptions, AudioSegment } from './lib/AudioPlayer';
export { AudioRecorder } from './lib/AudioRecorder';
export type { AudioRecorderOptions, AudioChunk, ChunkCallback } from './lib/AudioRecorder';
export { AudioStreamPlayer } from './lib/AudioStreamPlayer';
export type { AudioStreamPlayerOptions } from './lib/AudioStreamPlayer';
export {
  float32ToPcm16,
  pcm16ToWav,
  float32ToWav,
  audioBufferToWav,
  mergePcm16Chunks,
  pcm16Duration,
} from './lib/audio';
