import { memo } from 'react';
import { Languages, ChevronDown } from 'lucide-react';
import { Button, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { NodeProps } from '@xyflow/react';
import type { TranslateNode as TranslateNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';
import { Markdown } from './Markdown';
import { supportedLanguages } from '../contexts/TranslateContext';
import { CopyButton } from './CopyButton';

export const TranslateNode = memo(({ id, data, selected }: NodeProps<TranslateNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getText, connectedData, isProcessing, executeAsync } = useWorkflowNode(id);
  const config = getConfig();
  const client = config.client;

  const languages = supportedLanguages();

  const handleExecute = async () => {
    // Get the input text from connected nodes only
    if (connectedData.length === 0) {
      updateNode(id, {
        data: { ...data, outputText: 'Error: No input connected' }
      });
      return;
    }
    
    const inputText = getText();
    
    await executeAsync(async () => {
      try {
        // Translate the text
        const translatedResult = await client.translate(
          data.language || 'en',
          inputText
        );

        let finalOutput = '';
        if (typeof translatedResult === 'string') {
          finalOutput = translatedResult;
        } else {
          // If it's a Blob, we can't handle it in this node
          finalOutput = 'Error: File translation not supported in this node';
        }

        // Update output
        updateNode(id, {
          data: { ...data, outputText: finalOutput }
        });
      } catch (error) {
        console.error('Error executing translation:', error);
        updateNode(id, {
          data: { ...data, outputText: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }
        });
      }
    });
  };

  const languageSelector = (
    <Menu>
      <MenuButton className="nodrag inline-flex items-center gap-1 px-2 py-1 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <span>
          {languages.find(l => l.code === (data.language || 'en'))?.name || 'English'}
        </span>
        <ChevronDown size={12} className="opacity-50" />
      </MenuButton>
      <MenuItems
        transition
        anchor="bottom end"
        className="!max-h-[50vh] mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50 min-w-[140px]"
      >
        {languages.map((lang) => (
          <MenuItem key={lang.code}>
            <Button
              onClick={() => updateNode(id, { data: { ...data, language: lang.code } })}
              className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-100 dark:data-[focus]:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
            >
              {lang.name}
            </Button>
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
      headerActions={
        <>
          {languageSelector}
          {data.outputText && <CopyButton text={data.outputText} />}
        </>
      }
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        {data.outputText && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide nowheel">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{data.outputText}</Markdown>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});

TranslateNode.displayName = 'TranslateNode';
