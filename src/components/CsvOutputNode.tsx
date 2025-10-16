import { memo, useState } from 'react';
import { Table } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import type { CsvOutputNode as CsvOutputNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { getConfig } from '../config';
import { CsvRenderer } from './CsvRenderer';
import { WorkflowNode } from './WorkflowNode';
import { getConnectedNodeData } from '../lib/workflow';

export const CsvOutputNode = memo(({ id, data, selected }: NodeProps<CsvOutputNodeType>) => {
  const { updateNode, nodes, edges } = useWorkflow();
  const [isProcessing, setIsProcessing] = useState(false);
  const config = getConfig();
  const client = config.client;

  const handleExecute = async () => {
    // Get input from connected nodes only
    const connectedData = getConnectedNodeData(id, nodes, edges);
    const inputContent = connectedData.join('\n\n---\n\n');
    
    if (!inputContent) return;
    
    setIsProcessing(true);
    // Clear any previous error when starting a new execution
    updateNode(id, {
      data: { ...data, error: undefined }
    });
    
    try {
      // Use the convertCSV method from the client
      const csvData = await client.convertCSV('', inputContent);

      // Set final output
      updateNode(id, {
        data: { ...data, csvData, error: undefined }
      });
    } catch (error) {
      console.error('Error extracting CSV:', error);
      updateNode(id, {
        data: { ...data, error: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const hasConnectedNodes = edges.filter(e => e.target === id).length > 0;

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Table}
      title="CSV Output"
      color="purple"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={hasConnectedNodes}
      showInputHandle={true}
      showOutputHandle={true}
      minWidth={500}
    >
      <div className="flex-1 flex items-center justify-center min-h-0 p-4">
        {data.error ? (
          <div className="w-full px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-600 dark:text-red-400 text-sm">{data.error}</p>
          </div>
        ) : data.csvData ? (
          <div className="w-full h-full overflow-auto scrollbar-hide">
            <CsvRenderer csv={data.csvData} language="csv" />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 text-gray-400 dark:text-gray-600">
            <Table size={48} strokeWidth={1} />
            <div className="flex flex-col gap-2 w-32">
              <div className="grid grid-cols-3 gap-1">
                <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
                <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
                <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
              </div>
              <div className="grid grid-cols-3 gap-1">
                <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
                <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
                <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
              </div>
              <div className="grid grid-cols-3 gap-1">
                <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
                <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
                <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});
