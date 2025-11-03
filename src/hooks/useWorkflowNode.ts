import { useMemo, useState, useCallback } from 'react';
import { useWorkflow } from './useWorkflow';
import { getConnectedNodeData, getText, getLabeledText } from '../lib/workflow';

/**
 * Hook for workflow nodes that provides helper methods for working with connected data
 * and common node state management
 */
export function useWorkflowNode(nodeId: string) {
  const { nodes, edges } = useWorkflow();
  const [isProcessing, setIsProcessing] = useState(false);

  const connectedDataMemo = useMemo(() => {
    return getConnectedNodeData(nodeId, nodes, edges);
  }, [nodeId, nodes, edges]);

  const helpers = useMemo(() => {
    return {
      // Get the raw connected data objects
      connectedData: connectedDataMemo,
      
      // Get plain text from connected nodes
      getText: (separator?: string) => getText(connectedDataMemo, separator),
      
      // Get labeled text table from connected nodes
      getLabeledText: () => getLabeledText(connectedDataMemo),
      
      // Check if node has any connections
      hasConnections: connectedDataMemo.length > 0,
    };
  }, [connectedDataMemo]);

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

