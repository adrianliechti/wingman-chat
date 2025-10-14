import { memo, useState } from 'react';
import { Languages, Check, ChevronDown } from 'lucide-react';
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import type { NodeProps } from '@xyflow/react';
import type { TranslateNode as TranslateNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';
import { getConnectedNodeData } from '../lib/workflowUtils';
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
        <div className="flex-shrink-0 grid grid-cols-3 gap-2">
          {/* Language Dropdown */}
          <div>
            <Listbox
              value={data.language || 'en'}
              onChange={(value) => updateNode(id, { 
                data: { ...data, language: value } 
              })}
            >
              <div className="relative">
                <ListboxButton className="nodrag relative w-full px-2.5 py-1.5 text-xs text-left bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm hover:bg-white dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all cursor-pointer">
                  <span className="block truncate text-slate-700 dark:text-slate-200">
                    {languages.find(l => l.code === (data.language || 'en'))?.name || 'English'}
                  </span>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronDown className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  </span>
                </ListboxButton>
                <ListboxOptions className="nodrag absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg bg-white dark:bg-slate-800 py-1 text-xs shadow-lg ring-1 ring-slate-900/5 dark:ring-slate-700 focus:outline-none">
                  {languages.map((lang) => (
                    <ListboxOption
                      key={lang.code}
                      value={lang.code}
                      className="relative cursor-pointer select-none py-2 pl-8 pr-4 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50 data-[selected]:bg-orange-50 dark:data-[selected]:bg-orange-900/20 data-[selected]:text-orange-600 dark:data-[selected]:text-orange-400"
                    >
                      {({ selected }) => (
                        <>
                          <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                            {lang.name}
                          </span>
                          {selected ? (
                            <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-orange-600 dark:text-orange-400">
                              <Check className="h-3 w-3" aria-hidden="true" />
                            </span>
                          ) : null}
                        </>
                      )}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            </Listbox>
          </div>

          {/* Tone Dropdown */}
          <div>
            <Listbox
              value={data.tone || ''}
              onChange={(value) => updateNode(id, { 
                data: { ...data, tone: value } 
              })}
            >
              <div className="relative">
                <ListboxButton className="nodrag relative w-full px-2.5 py-1.5 text-xs text-left bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm hover:bg-white dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all cursor-pointer">
                  <span className="block truncate text-slate-700 dark:text-slate-200">
                    {tones.find(t => t.value === (data.tone || ''))?.label || 'Default'}
                  </span>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronDown className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  </span>
                </ListboxButton>
                <ListboxOptions className="nodrag absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg bg-white dark:bg-slate-800 py-1 text-xs shadow-lg ring-1 ring-slate-900/5 dark:ring-slate-700 focus:outline-none">
                  {tones.map((tone) => (
                    <ListboxOption
                      key={tone.value}
                      value={tone.value}
                      className="relative cursor-pointer select-none py-2 pl-8 pr-4 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50 data-[selected]:bg-orange-50 dark:data-[selected]:bg-orange-900/20 data-[selected]:text-orange-600 dark:data-[selected]:text-orange-400"
                    >
                      {({ selected }) => (
                        <>
                          <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                            {tone.label}
                          </span>
                          {selected ? (
                            <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-orange-600 dark:text-orange-400">
                              <Check className="h-3 w-3" aria-hidden="true" />
                            </span>
                          ) : null}
                        </>
                      )}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            </Listbox>
          </div>

          {/* Style Dropdown */}
          <div>
            <Listbox
              value={data.style || ''}
              onChange={(value) => updateNode(id, { 
                data: { ...data, style: value } 
              })}
            >
              <div className="relative">
                <ListboxButton className="nodrag relative w-full px-2.5 py-1.5 text-xs text-left bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm hover:bg-white dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all cursor-pointer">
                  <span className="block truncate text-slate-700 dark:text-slate-200">
                    {styles.find(s => s.value === (data.style || ''))?.label || 'Default'}
                  </span>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronDown className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  </span>
                </ListboxButton>
                <ListboxOptions className="nodrag absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg bg-white dark:bg-slate-800 py-1 text-xs shadow-lg ring-1 ring-slate-900/5 dark:ring-slate-700 focus:outline-none">
                  {styles.map((style) => (
                    <ListboxOption
                      key={style.value}
                      value={style.value}
                      className="relative cursor-pointer select-none py-2 pl-8 pr-4 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50 data-[selected]:bg-orange-50 dark:data-[selected]:bg-orange-900/20 data-[selected]:text-orange-600 dark:data-[selected]:text-orange-400"
                    >
                      {({ selected }) => (
                        <>
                          <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                            {style.label}
                          </span>
                          {selected ? (
                            <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-orange-600 dark:text-orange-400">
                              <Check className="h-3 w-3" aria-hidden="true" />
                            </span>
                          ) : null}
                        </>
                      )}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            </Listbox>
          </div>
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
