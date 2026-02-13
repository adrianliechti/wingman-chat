import type { RepositoryNodeType } from './RepositoryNode';

// Factory function to create a new RepositoryNode
export function createRepositoryNode(position: { x: number; y: number }): RepositoryNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'repository',
    position,
    data: {
      repositoryId: '',
      query: '',
      useInput: false
    }
  };
}
