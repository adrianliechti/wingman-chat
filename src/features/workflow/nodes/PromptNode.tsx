import { memo, useState, useEffect, useRef } from 'react';
import { Sparkles, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData, DataItem } from '@/features/workflow/types/workflow';
import { getDataText } from '@/features/workflow/types/workflow';
import type { Model } from '@/shared/types/chat';
import { useWorkflow } from '@/features/workflow/hooks/useWorkflow';
import { useWorkflowNode } from '@/features/workflow/hooks/useWorkflowNode';
import { getConfig } from '@/shared/config';
import { Role, getTextFromContent } from '@/shared/types/chat';
import { WorkflowNode } from '@/features/workflow/components/WorkflowNode';
import { Markdown } from '@/shared/ui/Markdown';
import { CopyButton } from '@/shared/ui/CopyButton';

// PromptNode data interface
export interface PromptNodeData extends BaseNodeData {
  prompt?: string;
  model?: string;
}

// PromptNode type
export type PromptNodeType = Node<PromptNodeData, 'prompt'>;

export const PromptNode = memo(({ id, data, selected }: NodeProps<PromptNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getText, connectedItems, hasConnections, isProcessing, executeAsync } = useWorkflowNode(id);
  const [models, setModels] = useState<Model[]>([]);
  const [localPrompt, setLocalPrompt] = useState(data.prompt ?? '');
  const [activeTab, setActiveTab] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isLocalChangeRef = useRef(false);
  const config = getConfig();
  const client = config.client;

  // Sync external data.prompt changes to local state (e.g., when undo/redo happens)
  useEffect(() => {
    // Skip if this update was triggered by local changes
    if (isLocalChangeRef.current) {
      isLocalChangeRef.current = false;
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalPrompt(data.prompt ?? '');
  }, [data.prompt]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const modelList = await client.listModels("completer");
        setModels(modelList);
      } catch (error) {
        console.error('Error loading models:', error);
      }
    };
    loadModels();
  }, [client]);

  const handleExecute = async () => {
    if (!localPrompt?.trim()) return;
    
    await executeAsync(async () => {
      try {
        if (hasConnections && connectedItems.length > 0) {
          // Process prompt on each input item
          const results: DataItem<string>[] = [];
          
          for (const item of connectedItems) {
            // Build the user message content with this item's context
            const messageContent = `${localPrompt}\n\n---\n\n${item.text}`;

            try {
              const response = await client.complete(
                data.model || '',
                'Provide only the final answer. Do not include any preamble, explanation, or chain of thinking.',
                [{
                  role: Role.User,
                  content: [{ type: 'text', text: messageContent }],
                }],
                [],
                (contentParts) => {
                  // Update data in real-time with current results + streaming item
                  const snapshot = getTextFromContent(contentParts);
                  const currentResults = [...results, { value: snapshot, text: snapshot }];
                  updateNode(id, {
                    data: { ...data, output: { items: currentResults }, error: undefined }
                  });
                }
              );

              const responseText = getTextFromContent(response.content);
              results.push({
                value: responseText,
                text: responseText,
              });

              // Update with completed result
              updateNode(id, {
                data: { ...data, output: { items: results }, error: undefined }
              });
            } catch (error) {
              console.error('Error executing LLM for item:', error);
              results.push({
                value: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              });
            }
          }

          // Set final data with all results
          updateNode(id, {
            data: { ...data, output: { items: results }, error: undefined }
          });
        } else {
          // No connections: original behavior (single output)
          const contextText = getText();
          
          let messageContent = localPrompt || '';
          
          if (contextText) {
            messageContent = `${messageContent}\n\n---\n\n${contextText}`;
          }

          const response = await client.complete(
            data.model || '',
            'Provide only the final answer. Do not include any preamble, explanation, or chain of thinking.',
            [{
              role: Role.User,
              content: [{ type: 'text', text: messageContent }],
            }],
            [],
            (contentParts) => {
              const snapshot = getTextFromContent(contentParts);
              updateNode(id, {
                data: { ...data, output: { items: [{ value: snapshot, text: snapshot }] }, error: undefined }
              });
            }
          );

          const responseText = getTextFromContent(response.content);
          updateNode(id, {
            data: { ...data, output: { items: [{ value: responseText, text: responseText }] }, error: undefined }
          });
        }
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
              <button
                type="button"
                onClick={() => updateNode(id, { data: { ...data, model: model.id } })}
                className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
              >
                {model.name}
              </button>
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
      canExecute={!!localPrompt?.trim()}
      showInputHandle={true}
      showOutputHandle={true}
      error={data.error}
      headerActions={
        <>
          {modelSelector}
          {data.output && <CopyButton text={getDataText(data.output)} />}
        </>
      }
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        {/* Prompt Input */}
        <div className="shrink-0">
          <textarea
            ref={textareaRef}
            value={localPrompt}
            onChange={(e) => {
              const newValue = e.target.value;
              setLocalPrompt(newValue);
              isLocalChangeRef.current = true;
              updateNode(id, { data: { ...data, prompt: newValue } });
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Instructions"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 focus:outline-none transition-all resize-y min-h-[60px] nodrag"
          />
        </div>

        {data.output && data.output.items.length > 1 ? (
          // Multiple results: show with tabs
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-t-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>
                  {data.output.items[activeTab]?.text || ''}
                </Markdown>
              </div>
            </div>
            {/* Tab navigation at bottom */}
            <div className="shrink-0 flex items-center justify-between px-2 py-1.5 bg-gray-200/50 dark:bg-black/20 rounded-b-lg border-t border-gray-200/50 dark:border-gray-700/50">
              <button
                onClick={() => setActiveTab(Math.max(0, activeTab - 1))}
                disabled={activeTab === 0}
                className="p-1 rounded hover:bg-gray-300/50 dark:hover:bg-gray-700/50 disabled:opacity-30 transition-colors nodrag"
              >
                <ChevronLeft size={14} />
              </button>
              <div className="flex items-center gap-1">
                {data.output.items.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveTab(idx)}
                    className={`w-6 h-6 text-xs rounded transition-colors nodrag ${
                      idx === activeTab
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-300/50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 hover:bg-gray-400/50 dark:hover:bg-gray-600/50'
                    }`}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setActiveTab(Math.min(data.output!.items.length - 1, activeTab + 1))}
                disabled={activeTab === data.output.items.length - 1}
                className="p-1 rounded hover:bg-gray-300/50 dark:hover:bg-gray-700/50 disabled:opacity-30 transition-colors nodrag"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ) : data.output && data.output.items.length === 1 ? (
          // Single result
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>
                  {data.output.items[0].text}
                </Markdown>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </WorkflowNode>
  );
});
