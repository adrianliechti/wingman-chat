import { memo, useState } from 'react';
import { Languages, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData, Data } from '../types/workflow';
import { getDataText } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';
import { Markdown } from './Markdown';
import { supportedLanguages } from '../contexts/TranslateContext';
import { CopyButton } from './CopyButton';

// TranslateNode data interface
export interface TranslateNodeData extends BaseNodeData {
  language?: string;
}

// TranslateNode type
export type TranslateNodeType = Node<TranslateNodeData, 'translate'>;

export const TranslateNode = memo(({ id, data, selected }: NodeProps<TranslateNodeType>) => {
  const { updateNode } = useWorkflow();
  const { connectedData, isProcessing, executeAsync } = useWorkflowNode(id);
  const config = getConfig();
  const client = config.client;
  const [activeTab, setActiveTab] = useState(0);

  const languages = supportedLanguages();

  const handleExecute = async () => {
    // Get the input text from connected nodes only
    if (connectedData.items.length === 0) {
      updateNode(id, {
        data: { ...data, output: undefined, error: 'No input connected' }
      });
      return;
    }
    
    await executeAsync(async () => {
      try {
        // Translate each connected input separately
        const translatedItems: { value: string; text: string }[] = [];
        
        for (const item of connectedData.items) {
          const inputText = item.text;
          const translatedResult = await client.translate(
            data.language || 'en',
            inputText
          );

          if (typeof translatedResult === 'string') {
            translatedItems.push({ value: translatedResult, text: translatedResult });
          } else {
            // If it's a Blob, we can't handle it in this node
            translatedItems.push({ 
              value: 'Error: File translation not supported in this node', 
              text: 'Error: File translation not supported in this node' 
            });
          }
        }

        // Update output with all translated items
        const output: Data<string> = {
          items: translatedItems
        };
        
        updateNode(id, {
          data: { ...data, output, error: undefined }
        });
        
        // Reset to first tab if current tab would be out of bounds
        if (activeTab >= translatedItems.length) {
          setActiveTab(0);
        }
      } catch (error) {
        console.error('Error executing translation:', error);
        updateNode(id, {
          data: { ...data, output: undefined, error: error instanceof Error ? error.message : 'Unknown error' }
        });
      }
    });
  };

  const languageSelector = (
    <Menu>
      <MenuButton className="nodrag inline-flex items-center gap-1 px-2 py-1 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <ChevronDown size={12} className="opacity-50" />
        <span>
          {languages.find(l => l.code === (data.language || 'en'))?.name || 'English'}
        </span>
      </MenuButton>
      <MenuItems
        modal={false}
        transition
        anchor="bottom end"
        className="max-h-[50vh]! mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50 min-w-[140px]"
      >
        {languages.map((lang) => (
          <MenuItem key={lang.code}>
            <button
              type="button"
              onClick={() => updateNode(id, { data: { ...data, language: lang.code } })}
              className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
            >
              {lang.name}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Languages}
      title="Translate"
      color="orange"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={true}
      showInputHandle={true}
      showOutputHandle={true}
      error={data.error}
      headerActions={
        <>
          {languageSelector}
          {data.output && <CopyButton text={getDataText(data.output)} />}
        </>
      }
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        {data.output && data.output.items.length > 1 ? (
          // Multiple results: show with tabs
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-t-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{data.output.items[activeTab]?.text || ''}</Markdown>
              </div>
            </div>
            {/* Tab navigation at bottom */}
            <div className="shrink-0 flex items-center justify-between px-2 py-1.5 bg-gray-200/50 dark:bg-black/20 rounded-b-lg border-t border-gray-200/50 dark:border-gray-700/50">
              <button
                onClick={() => setActiveTab(Math.max(0, activeTab - 1))}
                disabled={activeTab === 0}
                className="p-1 rounded hover:bg-gray-300/50 dark:hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors nodrag"
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
                        ? 'bg-orange-500 text-white'
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
                className="p-1 rounded hover:bg-gray-300/50 dark:hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors nodrag"
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
                <Markdown>{data.output.items[0].text}</Markdown>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </WorkflowNode>
  );
});

TranslateNode.displayName = 'TranslateNode';
