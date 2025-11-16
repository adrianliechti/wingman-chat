import type { TextNodeType } from './TextNode';

// Factory function to create a new TextNode
export function createTextNode(position: { x: number; y: number }): TextNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    position,
    data: {
      outputText: ''
    }
  };
}
