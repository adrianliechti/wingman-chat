import type { CsvNodeType } from './CsvNode';

// Factory function to create a new CsvNode
export function createCsvNode(position: { x: number; y: number }): CsvNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'csv',
    position,
    data: {
      csvData: undefined,
      error: undefined,
      useInput: false
    }
  };
}
