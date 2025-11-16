import type { AudioNodeType } from './AudioNode';

// Factory function to create a new AudioNode
export function createAudioNode(position: { x: number; y: number }): AudioNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'audio',
    position,
    data: {
      audioUrl: undefined,
      error: undefined,
      useInput: false
    }
  };
}
