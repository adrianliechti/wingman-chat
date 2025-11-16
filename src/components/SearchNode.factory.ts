import type { SearchNodeType } from './SearchNode';

// Factory function to create a new SearchNode
export function createSearchNode(position: { x: number; y: number }): SearchNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'search',
    position,
    data: {
      query: '',
      outputText: ''
    }
  };
}
