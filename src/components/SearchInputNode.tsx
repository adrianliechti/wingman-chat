import { memo, useState } from 'react';
import { Globe, ExternalLink } from 'lucide-react';
import { Input } from '@headlessui/react';
import type { NodeProps } from '@xyflow/react';
import type { SearchInputNode as SearchInputNodeType } from '../types/workflow';
import type { SearchResult } from '../types/search';
import { useWorkflow } from '../hooks/useWorkflow';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';
import { getConnectedNodeData } from '../lib/workflowUtils';

export const SearchInputNode = memo(({ id, data, selected }: NodeProps<SearchInputNodeType>) => {
  const { updateNode, nodes, edges } = useWorkflow();
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const config = getConfig();
  const client = config.client;

  const handleExecute = async () => {
    let query = data.inputText?.trim() || '';
    
    // If no input text, check for connected nodes
    if (!query) {
      const connectedData = getConnectedNodeData(id, nodes, edges);
      if (connectedData.length > 0) {
        query = connectedData[0]; // Use first connected node's output
      }
    }

    if (!query) return;
    
    setIsSearching(true);
    try {
      const results = await client.search(query);
      setSearchResults(results);
      
      // Concatenate all results into text format for output
      const resultText = results.map((result, index) => {
        let text = `Result ${index + 1}:\n`;
        if (result.title) text += `Title: ${result.title}\n`;
        if (result.source) text += `Source: ${result.source}\n`;
        text += `Content: ${result.content}\n`;
        return text;
      }).join('\n---\n\n');

      updateNode(id, {
        data: { ...data, outputText: resultText || 'No results found' }
      });
    } catch (error) {
      console.error('Error searching:', error);
      setSearchResults([]);
      updateNode(id, {
        data: { ...data, outputText: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }
      });
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Globe}
      title="Search Input"
      color="blue"
      onExecute={handleExecute}
      isProcessing={isSearching}
      canExecute={true}
      showInputHandle={true}
      showOutputHandle={true}
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        <div className="flex-shrink-0">
          <Input
            type="text"
            value={data.inputText || ''}
            onChange={(e) => updateNode(id, { 
              data: { ...data, inputText: e.target.value } 
            })}
            placeholder="Enter search query..."
            className="w-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 focus:outline-none transition-all nodrag"
          />
        </div>

        {searchResults.length > 0 && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-hide nowheel">
              {searchResults.map((result, index) => (
                <div
                  key={index}
                  className="p-2.5 rounded-lg border border-gray-200/50 dark:border-gray-700/50 bg-white/50 dark:bg-black/20 hover:bg-white/70 dark:hover:bg-black/30 transition-colors nodrag"
                >
                  {result.title && (
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1 truncate">
                      {result.title}
                    </h4>
                  )}
                  {result.source && (
                    <a
                      href={result.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline mb-1.5 max-w-full"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{result.source}</span>
                    </a>
                  )}
                  <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3">
                    {result.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});
