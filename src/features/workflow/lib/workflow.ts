import type { Data } from '@/features/workflow/types/workflow';
import { getDataText } from '@/features/workflow/types/workflow';

// Helper function to get connected node data as a single combined Data
// Expands and merges all items from connected nodes
export function getConnectedData(
  nodeId: string,
  nodes: Array<{ id: string; data: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string }>
): Data {
  const incomingEdges = edges.filter(edge => edge.target === nodeId);
  const result: Data = { items: [] };
  
  for (const edge of incomingEdges) {
    const sourceNode = nodes.find(n => n.id === edge.source);
    if (sourceNode?.data) {
      const nodeOutput = sourceNode.data.output as Data | undefined;
      
      if (nodeOutput && nodeOutput.items && nodeOutput.items.length > 0) {
        // Add each item from the data
        result.items.push(...nodeOutput.items);
      } else {
        // Fallback: try to get text from output or legacy outputText property
        let text = getDataText(nodeOutput);
        if (!text && typeof sourceNode.data.outputText === 'string') {
          text = sourceNode.data.outputText;
        }
        if (text) {
          result.items.push({ value: text, text });
        }
      }
    }
  }
  
  return result;
}

// Helper function to get combined text from connected nodes
export function getConnectedText(
  nodeId: string,
  nodes: Array<{ id: string; data: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string }>,
  separator: string = '\n\n'
): string {
  const data = getConnectedData(nodeId, nodes, edges);
  return data.items.map(item => item.text).join(separator);
}
