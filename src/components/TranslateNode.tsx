import { memo, useState } from 'react';
import { Languages, GlobeIcon, ThermometerIcon, SwatchBookIcon } from 'lucide-react';
import { Button, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { NodeProps } from '@xyflow/react';
import type { TranslateNode as TranslateNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';
import { getConnectedNodeData } from '../lib/workflow';
import { Markdown } from './Markdown';
import { supportedLanguages, toneOptions, styleOptions } from '../contexts/TranslateContext';

export const TranslateNode = memo(({ id, data, selected }: NodeProps<TranslateNodeType>) => {
  const { updateNode, nodes, edges } = useWorkflow();
  const [isProcessing, setIsProcessing] = useState(false);
  const config = getConfig();
  const client = config.client;

  const languages = supportedLanguages();
  const tones = toneOptions();
  const styles = styleOptions();

  const handleExecute = async () => {
    // Get the input text from connected nodes only
    const connectedData = getConnectedNodeData(id, nodes, edges);
    
    if (connectedData.length === 0) {
      updateNode(id, {
        data: { ...data, outputText: 'Error: No input connected' }
      });
      return;
    }
    
    const inputText = connectedData.join('\n\n');
    
    setIsProcessing(true);
    try {
      // Translate the text
      const translatedResult = await client.translate(
        data.language || 'en',
        inputText
      );

      let finalOutput = '';
      if (typeof translatedResult === 'string') {
        // If tone or style is set, apply rewriting
        if (data.tone || data.style) {
          finalOutput = await client.rewriteText(
            config.translator.model || '',
            translatedResult,
            data.language,
            data.tone,
            data.style
          );
        } else {
          finalOutput = translatedResult;
        }
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
    } finally {
      setIsProcessing(false);
    }
  };

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
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        {/* Settings Row */}
        <div className="flex-shrink-0 flex items-center gap-2 flex-wrap">
          {/* Language selector */}
          <Menu>
            <MenuButton className="nodrag inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg">
              <GlobeIcon size={14} />
              <span>
                {languages.find(l => l.code === (data.language || 'en'))?.name || 'English'}
              </span>
            </MenuButton>
            <MenuItems
              transition
              anchor="bottom start"
              className="!max-h-[50vh] mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50"
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

          {/* Tone selector */}
          <Menu>
            <MenuButton className="nodrag inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg">
              <ThermometerIcon size={14} />
              <span>
                {data.tone ? tones.find(t => t.value === data.tone)?.label : 'Tone'}
              </span>
            </MenuButton>
            <MenuItems
              transition
              anchor="bottom start"
              className="mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50"
            >
              {tones.map((toneOption) => (
                <MenuItem key={toneOption.value}>
                  <Button
                    onClick={() => updateNode(id, { data: { ...data, tone: toneOption.value } })}
                    className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-100 dark:data-[focus]:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
                  >
                    {toneOption.label}
                  </Button>
                </MenuItem>
              ))}
            </MenuItems>
          </Menu>

          {/* Style selector */}
          <Menu>
            <MenuButton className="nodrag inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg">
              <SwatchBookIcon size={14} />
              <span>
                {data.style ? styles.find(s => s.value === data.style)?.label : 'Style'}
              </span>
            </MenuButton>
            <MenuItems
              transition
              anchor="bottom start"
              className="mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50"
            >
              {styles.map((styleOption) => (
                <MenuItem key={styleOption.value}>
                  <Button
                    onClick={() => updateNode(id, { data: { ...data, style: styleOption.value } })}
                    className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-100 dark:data-[focus]:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
                  >
                    {styleOption.label}
                  </Button>
                </MenuItem>
              ))}
            </MenuItems>
          </Menu>
        </div>

        {/* Output */}
        {data.outputText && (
          <div className="flex-1 min-h-0 flex flex-col">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 flex-shrink-0">
              Output
            </label>
            <div className="flex-1 overflow-auto px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20">
              <Markdown>{data.outputText}</Markdown>
            </div>
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});

TranslateNode.displayName = 'TranslateNode';
