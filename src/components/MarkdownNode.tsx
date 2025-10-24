import { memo } from 'react';
import { FileText } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';
import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';

// MarkdownNode data interface
export interface MarkdownNodeData extends BaseNodeData {
}

// MarkdownNode type
export type MarkdownNodeType = Node<MarkdownNodeData, 'markdown'>;

export const MarkdownNode = memo(({ id, data, selected }: NodeProps<MarkdownNodeType>) => {
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
        // Call the convertMD method to format as markdown
        const markdownOutput = await client.convertMD('', inputContent);

        // Set final output
        updateNode(id, {
          data: { ...data, outputText: markdownOutput, error: undefined }
        });
      } catch (error) {
        console.error('Error formatting markdown:', error);
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
      icon={FileText}
      title="Markdown"
      color="green"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={hasConnections}
      showInputHandle={true}
      showOutputHandle={true}
      minWidth={400}
      error={data.error}
      headerActions={
        data.outputText && <CopyButton text={data.outputText} />
      }
    >
      {data.error ? (
        <div className="flex-1 flex items-center justify-center min-h-0 p-4">
          <div className="w-full px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-600 dark:text-red-400 text-sm">{data.error}</p>
          </div>
        </div>
      ) : data.outputText ? (
        <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-lg bg-white dark:bg-black/20 text-gray-700 dark:text-gray-300 scrollbar-hide nowheel">
          <Markdown>{data.outputText}</Markdown>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center min-h-0 p-4">
          <div className="flex flex-col items-center justify-center gap-3 text-gray-400 dark:text-gray-600">
            <FileText size={48} strokeWidth={1} />
            <div className="flex flex-col gap-1 w-24">
              <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
              <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded w-3/4" />
              <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded w-1/2" />
            </div>
          </div>
        </div>
      )}
    </WorkflowNode>
  );
});
