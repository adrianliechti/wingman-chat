import type { ImageNodeType } from './ImageNode';

// Factory function to create a new ImageNode
export function createImageNode(position: { x: number; y: number }): ImageNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'image',
    position,
    data: {
      imageUrl: undefined,
      error: undefined,
      useInput: false
    }
  };
}
