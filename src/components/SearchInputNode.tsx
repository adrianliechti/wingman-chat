import { memo, useState } from 'react';
import { Globe, ChevronDown } from 'lucide-react';
import { Input, Menu, MenuButton, MenuItem, MenuItems, Button } from '@headlessui/react';
import type { NodeProps } from '@xyflow/react';
import type { SearchInputNode as SearchInputNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';
import { Markdown } from './Markdown';

type SearchMode = 'search' | 'research' | 'fetch';

export const SearchInputNode = memo(({ id, data, selected }: NodeProps<SearchInputNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getText, connectedData, hasConnections, isProcessing, executeAsync } = useWorkflowNode(id);
  const [mode, setMode] = useState<SearchMode>('search');
  const config = getConfig();
  const client = config.client;

  const handleExecute = async () => {
    let query = data.inputText?.trim() || '';
    
    // If connected nodes exist, use their data
    if (connectedData.length > 0) {
      query = getText(); // Use connected node outputs
    }

    if (!query) return;
    
    await executeAsync(async () => {
      try {
        if (mode === 'fetch') {
          // Call fetchText method
          const content = await client.fetchText(query);
          updateNode(id, {
            data: { ...data, outputText: content || 'No content fetched' }
          });
        } else if (mode === 'research') {
          // Call research method
          const result = await client.research(query);
          updateNode(id, {
            data: { ...data, outputText: result || 'No research results found' }
          });
        } else {
          // Call search method
          const results = await client.search(query);
          
          // Convert all results into markdown format for output
          const resultText = results.map((result, index) => {
            let text = `### Result ${index + 1}\n\n`;
            if (result.title) text += `**${result.title}**\n\n`;
            if (result.source) text += `[${result.source}](${result.source})\n\n`;
            text += `\`\`\`markdown\n${result.content}\n\`\`\`\n`;
            return text;
          }).join('\n---\n\n');

          updateNode(id, {
            data: { ...data, outputText: resultText || 'No results found' }
          });
        }
      } catch (error) {
        console.error(`Error ${mode === 'fetch' ? 'fetching' : mode === 'research' ? 'researching' : 'searching'}:`, error);
        updateNode(id, {
          data: { ...data, outputText: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }
        });
      }
    });
  };

  const displayValue = hasConnections ? getText() : (data.inputText || '');
  const canExecute = hasConnections || !!data.inputText?.trim();

  const modeSelector = (
    <Menu>
      <MenuButton className="nodrag inline-flex items-center gap-1 px-2 py-1 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <span>
          {mode === 'search' ? 'Search' : mode === 'research' ? 'Research' : 'Website'}
        </span>
        <ChevronDown size={12} className="opacity-50" />
      </MenuButton>
      <MenuItems
        transition
        anchor="bottom end"
        className="mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50 min-w-[120px]"
      >
        <MenuItem>
          <Button
            onClick={() => setMode('search')}
            className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-100 dark:data-[focus]:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
          >
            Search
          </Button>
        </MenuItem>
        <MenuItem>
          <Button
            onClick={() => setMode('fetch')}
            className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-100 dark:data-[focus]:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
          >
            Website
          </Button>
        </MenuItem>
        <MenuItem>
          <Button
            onClick={() => setMode('research')}
            className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-100 dark:data-[focus]:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
          >
            Research
          </Button>
        </MenuItem>
      </MenuItems>
    </Menu>
  );

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Globe}
      title="Web"
      color="blue"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={canExecute}
      showInputHandle={true}
      showOutputHandle={true}
      headerActions={modeSelector}
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        <div className="flex-shrink-0">
          <div className="flex gap-2">
            <Input
              type="text"
              value={displayValue}
              onChange={(e) => updateNode(id, { 
                data: { ...data, inputText: e.target.value } 
              })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && data.inputText?.trim() && !hasConnections) {
                  handleExecute();
                }
              }}
              disabled={hasConnections}
              placeholder={mode === 'fetch' ? 'Enter URL...' : mode === 'research' ? 'Enter instructions...' : 'Enter search query...'}
              className="flex-1 px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 focus:outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed nodrag"
            />
            <button
              onClick={handleExecute}
              disabled={!canExecute}
              className="px-4 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 dark:hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 nodrag"
            >
              {mode === 'search' ? 'Search' : mode === 'research' ? 'Research' : 'Fetch'}
            </button>
          </div>
        </div>

        {data.outputText && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide nowheel">
              <Markdown>{data.outputText}</Markdown>
            </div>
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});
