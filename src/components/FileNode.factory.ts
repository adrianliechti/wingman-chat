import type { FileNodeType } from './FileNode';

// Factory function to create a new FileNode
export function createFileNode(position: { x: number; y: number }): FileNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'file',
    position,
    data: {
      fileName: '',
      outputText: '',
      useInput: false
    }
  };
}
