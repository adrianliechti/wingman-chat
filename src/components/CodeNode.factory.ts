import type { CodeNodeType } from './CodeNode';

// Factory function to create a new CodeNode
export function createCodeNode(position: { x: number; y: number }): CodeNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'code',
    position,
    data: {
      outputText: '',
      prompt: '',
      generatedCode: ''
    }
  };
}
