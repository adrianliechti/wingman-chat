import type { TranslateNodeType } from './TranslateNode';

// Factory function to create a new TranslateNode
export function createTranslateNode(position: { x: number; y: number }): TranslateNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'translate',
    position,
    data: {
      outputText: '',
      useInput: false,
      language: 'en',
      tone: '',
      style: ''
    }
  };
}
