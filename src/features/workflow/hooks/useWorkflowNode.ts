import { useMemo, useState, useCallback } from 'react';
import { useWorkflow } from './useWorkflow';
import { getConnectedData, getConnectedText } from '@/features/workflow/lib/workflow';

export function useWorkflowNode(nodeId: string) {
  const { nodes, edges } = useWorkflow();
  const [isProcessing, setIsProcessing] = useState(false);

  const connectedData = useMemo(() => {
    return getConnectedData(nodeId, nodes, edges);
  }, [nodeId, nodes, edges]);

  const helpers = useMemo(() => {
    return {
      // Get the combined data from connected nodes
      connectedData,
      
      // Get the items from connected data
      connectedItems: connectedData.items,
      
      // Get combined text from connected nodes
      getText: (separator?: string) => getConnectedText(nodeId, nodes, edges, separator),
      
      // Check if node has any connections
      hasConnections: connectedData.items.length > 0,
    };
  }, [connectedData, nodeId, nodes, edges]);

  // Wrapper for async execution with automatic processing state management
  const executeAsync = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setIsProcessing(true);
    try {
      return await fn();
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return {
    ...helpers,
    isProcessing,
    setIsProcessing,
    executeAsync,
  };
}