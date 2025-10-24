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
      // Use edge label if available, otherwise fallback to node label or 'Input'
      const label = (edge.data?.label as string) || (nodeData.label as string) || 'Input';
      
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

// Helper function to format connected data with label headers in table format
export function getLabeledText(
  connectedData: Array<{ text: string; label: string }>
): string {
  if (connectedData.length === 0) {
    return '';
  }
  
  // Create a markdown table with Label and Content columns
  const rows = connectedData.map(({ text, label }) => {
    // Escape pipe characters and newlines in the content for table formatting
    const escapedText = text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    return `| ${label} | ${escapedText} |`;
  });
  
  return [
    '| Label | Content |',
    '|-------|---------|',
    ...rows
  ].join('\n');
}
