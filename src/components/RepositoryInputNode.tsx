import { memo, useState } from 'react';
import { Database, ChevronDown } from 'lucide-react';
import { Button, Input, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { NodeProps } from '@xyflow/react';
import type { RepositoryInputNode as RepositoryInputNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useRepositories } from '../hooks/useRepositories';
import { useRepository } from '../hooks/useRepository';
import { WorkflowNode } from './WorkflowNode';
import { getConnectedNodeData } from '../lib/workflow';
import { Markdown } from './Markdown';

export const RepositoryInputNode = memo(({ id, data, selected }: NodeProps<RepositoryInputNodeType>) => {
  const { updateNode, nodes, edges } = useWorkflow();
  const { repositories } = useRepositories();
  const [isProcessing, setIsProcessing] = useState(false);

  // Get the current repository
  const currentRepository = repositories.find(r => r.id === data.repositoryId);
  const { queryChunks } = useRepository(data.repositoryId || '', 'rag');

  const handleExecute = async () => {
    // Get the query from connected nodes or use the node's query field
    let query = data.query?.trim() || '';
    
    // If connected nodes exist, use their data
    const connectedData = getConnectedNodeData(id, nodes, edges);
    if (connectedData.length > 0) {
      query = connectedData.join('\n\n');
    }

    if (!query) {
      updateNode(id, {
        data: { ...data, outputText: 'Error: No query provided' }
      });
      return;
    }

    if (!data.repositoryId) {
      updateNode(id, {
        data: { ...data, outputText: 'Error: No repository selected' }
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Query the repository
      const chunks = await queryChunks(query, 10);

      if (chunks.length === 0) {
        updateNode(id, {
          data: { ...data, outputText: 'No results found for the query' }
        });
      } else {
        // Format the results
        const outputText = chunks
          .map((chunk, index) => {
            const similarity = chunk.similarity ? ` (${(chunk.similarity * 100).toFixed(1)}% match)` : '';
            return `### Result ${index + 1} - ${chunk.file.name}${similarity}\n\n${chunk.text}`;
          })
          .join('\n\n---\n\n');

        updateNode(id, {
          data: { ...data, outputText }
        });
      }
    } catch (error) {
      console.error('Error executing repository query:', error);
      updateNode(id, {
        data: { ...data, outputText: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const hasConnectedNodes = edges.filter(e => e.target === id).length > 0;
  const connectedData = hasConnectedNodes ? getConnectedNodeData(id, nodes, edges) : [];
  const displayValue = hasConnectedNodes ? connectedData.join('\n\n') : (data.query || '');
  const canExecute = !!data.repositoryId && (hasConnectedNodes || !!data.query?.trim());

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Database}
      title="Repository Search"
      color="purple"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={canExecute}
      showInputHandle={true}
      showOutputHandle={true}
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        {/* Settings Row */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {/* Repository selector */}
          <Menu>
            <MenuButton className="nodrag inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg">
              <Database size={14} />
              <span>
                {currentRepository?.name || 'Select Repository'}
              </span>
              <ChevronDown size={12} className="opacity-50" />
            </MenuButton>
            <MenuItems
              transition
              anchor="bottom start"
              className="!max-h-[50vh] mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50 min-w-[200px]"
            >
              {repositories.length === 0 ? (
                <div className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
                  No repositories available
                </div>
              ) : (
                repositories.map((repo) => (
                  <MenuItem key={repo.id}>
                    <Button
                      onClick={() => updateNode(id, { data: { ...data, repositoryId: repo.id } })}
                      className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-100 dark:data-[focus]:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
                    >
                      {repo.name}
                    </Button>
                  </MenuItem>
                ))
              )}
            </MenuItems>
          </Menu>
        </div>

        {/* Query Input */}
        <div className="flex-shrink-0">
          <div className="flex gap-2">
            <Input
              type="text"
              value={displayValue}
              onChange={(e) => updateNode(id, { 
                data: { ...data, query: e.target.value } 
              })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && data.query?.trim() && !hasConnectedNodes) {
                  handleExecute();
                }
              }}
              disabled={hasConnectedNodes}
              placeholder="Enter search query..."
              className="flex-1 px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 focus:outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed nodrag"
            />
            <button
              onClick={handleExecute}
              disabled={!canExecute}
              className="px-4 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 dark:hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 nodrag"
            >
              Search
            </button>
          </div>
        </div>

        {/* Output Display */}
        {data.outputText && (
          <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2 text-sm bg-white/30 dark:bg-black/10 rounded-md border border-neutral-200 dark:border-neutral-700 prose prose-sm dark:prose-invert max-w-none nodrag nowheel">
            <Markdown>
              {data.outputText}
            </Markdown>
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});
