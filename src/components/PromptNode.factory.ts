import type { PromptNodeType } from './PromptNode';

// Factory function to create a new PromptNode
export function createPromptNode(position: { x: number; y: number }): PromptNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'prompt',
    position,
    data: {
      outputText: '',
      prompt: ''
    }
  };
}
