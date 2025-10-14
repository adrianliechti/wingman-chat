import { memo, useState } from 'react';
import { FileType } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import type { MarkdownOutputNode as MarkdownOutputNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { getConfig } from '../config';
import { Role } from '../types/chat';
import type { Message } from '../types/chat';
import { Markdown } from './Markdown';
import { WorkflowNode } from './WorkflowNode';
import { getConnectedNodeData } from '../lib/workflowUtils';

export const MarkdownOutputNode = memo(({ id, data, selected }: NodeProps<MarkdownOutputNodeType>) => {
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
      // System message with instructions to format as markdown
      const instructions = `Format the following content as a well-structured, professional Markdown document using GitHub Flavored Markdown (GFM). Use appropriate headings, formatting, lists, code blocks with syntax highlighting, tables, task lists, and other GFM elements as needed to make it clear and readable. Preserve all the important information.`;

      // User message with the actual content
      const message: Message = {
        role: Role.User,
        content: inputContent
      };

      // Call the complete method to format the markdown
      const response = await client.complete(
        '', // use default model
        instructions,
        [message],
        [] // no tools
      );

      // Set final output
      updateNode(id, {
        data: { ...data, outputText: response.content, error: undefined }
      });
    } catch (error) {
      console.error('Error formatting markdown:', error);
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
      icon={FileType}
      title="Markdown Output"
      color="green"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={hasConnectedNodes}
      showInputHandle={true}
      showOutputHandle={true}
      minWidth={400}
    >
      <div className="flex-1 flex items-center justify-center min-h-0 p-4">
        {data.error ? (
          <div className="w-full px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-600 dark:text-red-400 text-sm">{data.error}</p>
          </div>
        ) : data.outputText ? (
          <div className="w-full h-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white dark:bg-black/20 text-gray-700 dark:text-gray-300 overflow-y-auto scrollbar-hide">
            <Markdown>{data.outputText}</Markdown>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 text-gray-400 dark:text-gray-600">
            <FileType size={48} strokeWidth={1} />
            <div className="flex flex-col gap-1 w-24">
              <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
              <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded w-3/4" />
              <div className="h-2 bg-gray-300/30 dark:bg-gray-700/30 rounded w-1/2" />
            </div>
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});
