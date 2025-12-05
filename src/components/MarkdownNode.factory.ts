import type { MarkdownNodeType } from './MarkdownNode';

// Factory function to create a new MarkdownNode
export function createMarkdownNode(position: { x: number; y: number }): MarkdownNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'markdown',
    position,
    data: {
      inputText: '',
      error: undefined,
      useInput: false
    }
  };
}
