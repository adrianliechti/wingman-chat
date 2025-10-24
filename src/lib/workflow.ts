// Helper function to get connected node data
export function getConnectedNodeData(
  nodeId: string,
  nodes: Array<{ id: string; data: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string; data?: Record<string, unknown> }>
): Array<{ text: string; label: string }> {
  const incomingEdges = edges.filter(edge => edge.target === nodeId);
  const connectedData: Array<{ text: string; label: string }> = [];
  
  for (const edge of incomingEdges) {
    const sourceNode = nodes.find(n => n.id === edge.source);
    if (sourceNode?.data) {
      const nodeData = sourceNode.data;
      // Use edge label if available, otherwise fallback to node label or empty string
      const label = (edge.data?.label as string) || (nodeData.label as string) || '';
      
      if (nodeData.outputText && typeof nodeData.outputText === 'string') {
        connectedData.push({ text: nodeData.outputText, label });
      }
    }
  }
  
  return connectedData;
}

// Helper function to format connected data into plain text (no labels)
export function getText(
  connectedData: Array<{ text: string; label: string }>,
  separator: string = '\n\n'
): string {
  if (connectedData.length === 0) {
    return '';
  }
  
  return connectedData.map(({ text }) => text).join(separator);
}

// Helper function to format connected data with label headers
export function getLabeledText(
  connectedData: Array<{ text: string; label: string }>
): string {
  if (connectedData.length === 0) {
    return '';
  }
  
  // Format each item with its label as a comment (if label exists)
  return connectedData.map(({ text, label }) => {
    if (label) {
      return `// ${label}\n${text}`;
    }
    return text;
  }).join('\n\n---\n\n');
}
