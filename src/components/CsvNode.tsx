import { memo } from 'react';
import { Table } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { CsvRenderer } from './CsvRenderer';
import { WorkflowNode } from './WorkflowNode';
import { CopyButton } from './CopyButton';

// CsvNode data interface
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CsvNodeData extends BaseNodeData {
}

// CsvNode type
export type CsvNodeType = Node<CsvNodeData, 'csv'>;

export const CsvNode = memo(({ id, data, selected }: NodeProps<CsvNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getLabeledText, hasConnections, isProcessing, executeAsync } = useWorkflowNode(id);
  const config = getConfig();
  const client = config.client;

  const handleExecute = async () => {
    // Get input from connected nodes only
    const inputContent = getLabeledText();
    
    if (!inputContent) return;
    
    await executeAsync(async () => {
      // Clear any previous error when starting a new execution
      updateNode(id, {
        data: { ...data, error: undefined }
      });
      
      try {
        // Use the convertCSV method from the client
        const csvData = await client.convertCSV('', inputContent);

        // Set final output
        updateNode(id, {
          data: { ...data, outputText: csvData, error: undefined }
        });
      } catch (error) {
        console.error('Error extracting CSV:', error);
        updateNode(id, {
          data: { ...data, error: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }
        });
      }
    });
  };

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Table}
      title="CSV"
      color="green"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={hasConnections}
      showInputHandle={true}
      showOutputHandle={true}
      minWidth={500}
      error={data.error}
      headerActions={
        data.outputText && <CopyButton text={data.outputText} />
      }
    >
      <div className="flex-1 flex items-center justify-center min-h-0 p-4">
        {data.outputText ? (
          <div className="w-full h-full overflow-auto scrollbar-hide">
            <CsvRenderer csv={data.outputText} language="csv" />
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
