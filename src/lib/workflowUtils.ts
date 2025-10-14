// Helper function to get connected node data
export function getConnectedNodeData(
  nodeId: string,
  nodes: Array<{ id: string; data: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string }>
): string[] {
  const incomingEdges = edges.filter(edge => edge.target === nodeId);
  const connectedData: string[] = [];
  
  for (const edge of incomingEdges) {
    const sourceNode = nodes.find(n => n.id === edge.source);
    if (sourceNode?.data) {
      const nodeData = sourceNode.data;
      if (nodeData.outputText && typeof nodeData.outputText === 'string') {
        connectedData.push(nodeData.outputText);
      } else if (nodeData.fileContent && typeof nodeData.fileContent === 'string') {
        connectedData.push(nodeData.fileContent);
      } else if (nodeData.content && typeof nodeData.content === 'string') {
        connectedData.push(nodeData.content);
      }
    }
  }
  
  return connectedData;
}
