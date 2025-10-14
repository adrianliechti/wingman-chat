import { memo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Textarea } from '@headlessui/react';
import type { NodeProps } from '@xyflow/react';
import type { LLMNode as PromptNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { getConfig } from '../config';
import { Role, AttachmentType } from '../types/chat';
import type { Message } from '../types/chat';
import { WorkflowNode } from './WorkflowNode';
import { getConnectedNodeData } from '../lib/workflowUtils';
import { Markdown } from './Markdown';

export const PromptNode = memo(({ id, data, selected }: NodeProps<PromptNodeType>) => {
  const { updateNode, nodes, edges } = useWorkflow();
  const [isProcessing, setIsProcessing] = useState(false);
  const config = getConfig();
  const client = config.client;

  const handleExecute = async () => {
    if (!data.inputText?.trim()) return;
    
    setIsProcessing(true);
    try {
      // Find all connected input nodes
      const connectedData = getConnectedNodeData(id, nodes, edges);
      const attachments: Array<{ type: AttachmentType; name: string; data: string }> = [];
      
      for (const content of connectedData) {
        // Generate random filename
        const randomId = Math.random().toString(36).substring(2, 8);
        attachments.push({
          type: AttachmentType.Text,
          name: `${randomId}.txt`,
          data: content
        });
      }

      // Build the message with the prompt as user content
      const userMessage: Message = {
        role: Role.User,
        content: data.inputText,
        attachments
      };

      // Call the complete method
      const response = await client.complete(
        '', // use empty string for model to use default
        '', // no system instructions for now
        [userMessage],
        [], // no tools
        (_delta, snapshot) => {
          // Update output in real-time as text streams in
          updateNode(id, {
            data: { ...data, outputText: snapshot }
          });
        }
      );

      // Set final output
      updateNode(id, {
        data: { ...data, outputText: response.content }
      });
    } catch (error) {
      console.error('Error executing LLM:', error);
      updateNode(id, {
        data: { ...data, outputText: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Sparkles}
      title="Prompt"
      color="purple"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={!!data.inputText?.trim()}
      showInputHandle={true}
      showOutputHandle={true}
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        <div className="flex-shrink-0">
          <Textarea
            value={data.inputText || ''}
            onChange={(e) => updateNode(id, { 
              data: { ...data, inputText: e.target.value } 
            })}
            placeholder="Instructions"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 focus:outline-none transition-all resize-none nodrag"
          />
        </div>

        {data.outputText && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-gray-100/50 dark:bg-black/10 overflow-auto scrollbar-hide">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>
                  {data.outputText}
                </Markdown>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});