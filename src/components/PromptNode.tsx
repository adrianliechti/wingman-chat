import { memo, useState, useEffect } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';
import { Button, Menu, MenuButton, MenuItem, MenuItems, Textarea } from '@headlessui/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData } from '../types/workflow';
import type { Model } from '../types/chat';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { Role } from '../types/chat';
import { WorkflowNode } from './WorkflowNode';
import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';

// PromptNode data interface
export interface PromptNodeData extends BaseNodeData {
  prompt?: string;
  model?: string;
}

// PromptNode type
export type PromptNodeType = Node<PromptNodeData, 'prompt'>;

// Factory function to create a new PromptNode
export function createPromptNode(position: { x: number; y: number }): PromptNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'prompt',
    position,
    data: {
      outputText: '',
      prompt: ''
    }
  };
}

export const PromptNode = memo(({ id, data, selected }: NodeProps<PromptNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getLabeledText, isProcessing, executeAsync } = useWorkflowNode(id);
  const [models, setModels] = useState<Model[]>([]);
  const [prompt, setPrompt] = useState(data.prompt || '');
  const config = getConfig();
  const client = config.client;

  useEffect(() => {
    const loadModels = async () => {
      try {
        const modelList = await client.listModels("completion");
        setModels(modelList);
      } catch (error) {
        console.error('Error loading models:', error);
      }
    };
    loadModels();
  }, [client]);

  useEffect(() => {
    setPrompt(data.prompt || '');
  }, [data.prompt]);

  const handleExecute = async () => {
    if (!prompt?.trim()) return;
    
    // Save the prompt to workflow state
    updateNode(id, { data: { ...data, prompt } });
    
    await executeAsync(async () => {
      // Get labeled text from connected nodes
      const contextText = getLabeledText();
      
      // Build the user message content
      let messageContent = prompt || '';
      
      // If there's connected data, append it as context
      if (contextText) {
        messageContent = `${messageContent}\n\n---\n\n${contextText}`;
      }

      try {
        // Call the complete method
        const response = await client.complete(
          data.model || '', // use selected model or default
          'Provide only the final answer. Do not include any preamble, explanation, or chain of thinking.',
          [{
            role: Role.User,
            content: messageContent,
          }],
          [], // no tools
          (_delta, snapshot) => {
            // Update output in real-time as text streams in
            updateNode(id, {
              data: { ...data, outputText: snapshot, error: undefined }
            });
          }
        );

        // Set final output
        updateNode(id, {
          data: { ...data, outputText: response.content, error: undefined }
        });
      } catch (error) {
        console.error('Error executing LLM:', error);
        updateNode(id, {
          data: { ...data, error: error instanceof Error ? error.message : 'Unknown error' }
        });
      }
    });
  };

  const currentModel = models.find(m => m.id === data.model);

  const modelSelector = (
    <Menu>
      <MenuButton className="nodrag inline-flex items-center gap-1 px-2 py-1 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <ChevronDown size={12} className="opacity-50" />
        <span>
          {currentModel?.name || 'Default'}
        </span>
      </MenuButton>
      <MenuItems
        modal={false}
        transition
        anchor="bottom end"
        className="max-h-[50vh]! mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50 min-w-[200px]"
      >
        {models.length === 0 ? (
          <div className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
            No models available
          </div>
        ) : (
          models.map((model) => (
            <MenuItem key={model.id}>
              <Button
                onClick={() => updateNode(id, { data: { ...data, model: model.id } })}
                className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
              >
                {model.name}
              </Button>
            </MenuItem>
          ))
        )}
      </MenuItems>
    </Menu>
  );

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Sparkles}
      title="Prompt"
      color="purple"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={!!prompt?.trim()}
      showInputHandle={true}
      showOutputHandle={true}
      error={data.error}
      headerActions={
        <>
          {modelSelector}
          {data.outputText && <CopyButton text={data.outputText} />}
        </>
      }
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        {/* Prompt Input */}
        <div className="shrink-0">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => updateNode(id, { data: { ...data, prompt } })}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Instructions"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 focus:outline-none transition-all resize-none nodrag"
          />
        </div>

        {data.outputText && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide nowheel">
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