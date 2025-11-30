import { memo, useState } from 'react';
import { Globe, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData, Data } from '../types/workflow';
import { getDataText } from '../types/workflow';
import type { SearchResult } from '../types/search';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { Role } from '../types/chat';
import { WorkflowNode } from './WorkflowNode';
import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';

// Helper to format a single search result as markdown
function formatSearchResult(result: SearchResult): string {
  let text = ``;
  if (result.title) text += `**${result.title}**\n`;
  if (result.source) text += `[${result.source}](${result.source})\n`;
  text += `\n`;
  text += result.content;
  return text;
}

// Helper to create structured data from search results
function createSearchData(results: SearchResult[]): Data<SearchResult> {
  return {
    items: results.map(result => ({
      value: result,
      text: formatSearchResult(result),
    })),
  };
}

// SearchNode data interface
export interface SearchNodeData extends BaseNodeData {
  query?: string;       // Used for direct query/URL input when no connections
  instructions?: string; // Used as guidance when there ARE connections
}

// SearchNode type
export type SearchNodeType = Node<SearchNodeData, 'search'>;

type SearchMode = 'search' | 'research' | 'fetch';

export const SearchNode = memo(({ id, data, selected }: NodeProps<SearchNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getText, connectedItems, hasConnections, isProcessing, executeAsync } = useWorkflowNode(id);
  const [mode, setMode] = useState<SearchMode>('search');
  const [activeTab, setActiveTab] = useState(0);
  const config = getConfig();
  const client = config.client;

  const handleExecute = async () => {
    const query = data.query?.trim() || '';
    const instructions = data.instructions?.trim() || '';
    
    await executeAsync(async () => {
      try {
        if (mode === 'fetch') {
          // === WEBSITE MODE ===
          const results: SearchResult[] = [];

          if (hasConnections) {
            // With input: use structured output to extract URL from each input
            for (let i = 0; i < connectedItems.length; i++) {
              const item = connectedItems[i];
              try {
                // Use structured output to extract URL from the input
                const extractedUrl = await client.extractUrl('', item.text);
                
                if (!extractedUrl || !extractedUrl.startsWith('http')) {
                  results.push({
                    title: 'Invalid URL',
                    content: `Could not extract valid URL from: ${item.text.substring(0, 100)}...`,
                  });
                  continue;
                }

                const content = await client.fetchText(extractedUrl);
                results.push({
                  title: extractedUrl,
                  source: extractedUrl,
                  content: content || 'No content fetched',
                });
              } catch (error) {
                results.push({
                  title: 'Error',
                  content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                });
              }
            }
          } else {
            // No input: use query field directly as URL
            if (!query) {
              updateNode(id, { data: { ...data, error: 'No URL provided' } });
              return;
            }

            try {
              const content = await client.fetchText(query);
              results.push({
                title: query,
                source: query,
                content: content || 'No content fetched',
              });
            } catch (error) {
              results.push({
                title: query,
                source: query,
                content: `Error fetching: ${error instanceof Error ? error.message : 'Unknown error'}`,
              });
            }
          }

          updateNode(id, {
            data: { 
              ...data, 
              output: results.length > 0 ? createSearchData(results) : undefined,
              error: undefined 
            }
          });

        } else if (mode === 'research') {
          // === RESEARCH MODE ===
          const results: SearchResult[] = [];

          if (hasConnections) {
            // With input: create research for each input using LLM to combine with instructions
            for (let i = 0; i < connectedItems.length; i++) {
              const item = connectedItems[i];
              try {
                let researchQuery: string;
                
                if (instructions) {
                  // Use LLM to create research query from input + instructions
                  const response = await client.complete(
                    '',
                    'Create a detailed research query that combines the user instructions with the provided context. Return only the research query, nothing else.',
                    [{
                      role: Role.User,
                      content: `Instructions: ${instructions}\n\nContext to research:\n${item.text}\n\nGenerate the research query:`,
                    }],
                    []
                  );
                  researchQuery = response.content.trim();
                } else {
                  // No instructions, use input directly
                  researchQuery = item.text;
                }

                const result = await client.research(researchQuery);
                results.push({
                  title: `Research ${i + 1}`,
                  content: result || 'No research results found',
                });
              } catch (error) {
                results.push({
                  title: `Research ${i + 1}`,
                  content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                });
              }
            }
          } else {
            // No input: use instructions field directly
            if (!instructions) {
              updateNode(id, { data: { ...data, error: 'No research topic provided' } });
              return;
            }

            try {
              const result = await client.research(instructions);
              results.push({
                title: 'Research',
                content: result || 'No research results found',
              });
            } catch (error) {
              results.push({
                title: 'Research',
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              });
            }
          }

          updateNode(id, {
            data: { 
              ...data, 
              output: results.length > 0 ? createSearchData(results) : undefined,
              error: undefined 
            }
          });

        } else {
          // === SEARCH MODE ===
          let searchQuery = '';

          if (hasConnections) {
            // With input: always use LLM to form optimized query from inputs
            const inputText = getText();
            
            try {
              const systemPrompt = instructions
                ? 'Generate a concise and effective search query based on the user instructions and the provided context. Return only the search query, nothing else.'
                : 'Generate a concise and effective search query based on the provided context. Return only the search query, nothing else.';
              
              const userContent = instructions
                ? `Instructions: ${instructions}\n\nContext:\n${inputText}\n\nGenerate the search query:`
                : `Context:\n${inputText}\n\nGenerate the search query:`;

              const response = await client.complete(
                '',
                systemPrompt,
                [{
                  role: Role.User,
                  content: userContent,
                }],
                []
              );
              searchQuery = response.content.trim();
            } catch (error) {
              console.error('Error generating search query:', error);
              // Fallback: combine instructions with input or just use input
              searchQuery = instructions ? `${instructions} ${inputText}` : inputText;
            }
          } else {
            // No input: use query field directly
            if (!query) {
              updateNode(id, { data: { ...data, error: 'No search query provided' } });
              return;
            }
            searchQuery = query;
          }

          // Perform the search
          const results = await client.search(searchQuery);
          
          updateNode(id, {
            data: { 
              ...data, 
              output: results.length > 0 ? createSearchData(results) : undefined,
              error: undefined 
            }
          });
        }
      } catch (error) {
        console.error(`Error ${mode === 'fetch' ? 'fetching' : mode === 'research' ? 'researching' : 'searching'}:`, error);
        updateNode(id, {
          data: { ...data, error: error instanceof Error ? error.message : 'Unknown error' }
        });
      }
    });
  };

  // Determine if we can execute based on mode and connection state
  const canExecute = hasConnections 
    ? true  // With connections, always allow (LLM will extract/combine)
    : mode === 'fetch' 
      ? !!data.query?.trim()  // Fetch without input needs URL
      : mode === 'research'
        ? !!data.instructions?.trim()  // Research without input needs instructions
        : !!data.query?.trim();  // Search without input needs query

  const modeSelector = (
    <Menu>
      <MenuButton className="nodrag inline-flex items-center gap-1 px-2 py-1 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <ChevronDown size={12} className="opacity-50" />
        <span>
          {mode === 'search' ? 'Search' : mode === 'research' ? 'Research' : 'Website'}
        </span>
      </MenuButton>
      <MenuItems
        modal={false}
        transition
        anchor="bottom end"
        className="mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50 min-w-[120px]"
      >
        <MenuItem>
          <button
            type="button"
            onClick={() => setMode('search')}
            className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
          >
            Search
          </button>
        </MenuItem>
        <MenuItem>
          <button
            type="button"
            onClick={() => setMode('fetch')}
            className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
          >
            Website
          </button>
        </MenuItem>
        <MenuItem>
          <button
            type="button"
            onClick={() => setMode('research')}
            className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
          >
            Research
          </button>
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
      error={data.error}
      headerActions={
        <>
          {modeSelector}
          {data.output && <CopyButton text={getDataText(data.output)} />}
        </>
      }
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        {/* 
          Input fields logic:
          - Search (no input): show query field
          - Search (with input): show instructions field  
          - Research (no input): show instructions field (used directly)
          - Research (with input): show instructions field (combined via LLM)
          - Website (no input): show URL field
          - Website (with input): hide field (URLs extracted from input via LLM)
        */}
        
        {/* Search mode: query field when no input, instructions when has input */}
        {mode === 'search' && !hasConnections && (
          <div className="shrink-0">
            <input
              type="text"
              value={data.query ?? ''}
              onChange={(e) => updateNode(id, { data: { ...data, query: e.target.value } })}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Enter search query..."
              className="w-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 focus:outline-none transition-all nodrag"
            />
          </div>
        )}
        
        {mode === 'search' && hasConnections && (
          <div className="shrink-0">
            <textarea
              value={data.instructions ?? ''}
              onChange={(e) => updateNode(id, { data: { ...data, instructions: e.target.value } })}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Instructions to help form search query from input..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 focus:outline-none transition-all resize-y min-h-[50px] nodrag"
            />
          </div>
        )}

        {/* Research mode: always show instructions field */}
        {mode === 'research' && (
          <div className="shrink-0">
            <textarea
              value={data.instructions ?? ''}
              onChange={(e) => updateNode(id, { data: { ...data, instructions: e.target.value } })}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder={hasConnections 
                ? "Instructions (combined with each input via LLM)..." 
                : "Enter research topic..."
              }
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 focus:outline-none transition-all resize-y min-h-[50px] nodrag"
            />
          </div>
        )}

        {/* Website mode: URL field only when no input */}
        {mode === 'fetch' && !hasConnections && (
          <div className="shrink-0">
            <input
              type="text"
              value={data.query ?? ''}
              onChange={(e) => updateNode(id, { data: { ...data, query: e.target.value } })}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Enter URL..."
              className="w-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 focus:outline-none transition-all nodrag"
            />
          </div>
        )}

        {/* Website mode with input: show hint that URLs will be extracted */}
        {mode === 'fetch' && hasConnections && (
          <div className="shrink-0 px-3 py-2 text-xs text-gray-500 dark:text-gray-400 italic">
            URLs will be extracted from connected inputs
          </div>
        )}

        {data.output && data.output.items.length > 1 ? (
          // Multiple results: show with tabs
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-t-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide">
              <Markdown>{data.output.items[activeTab]?.text || ''}</Markdown>
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
                        ? 'bg-blue-500 text-white'
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
          // Single result (search or fetch/research)
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide">
              <Markdown>{data.output.items[0].text}</Markdown>
            </div>
          </div>
        ) : null}
      </div>
    </WorkflowNode>
  );
});
