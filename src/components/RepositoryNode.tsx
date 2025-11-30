import { memo, useState } from 'react';
import { Database, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData, Data } from '../types/workflow';
import { getDataText } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { useRepositories } from '../hooks/useRepositories';
import { useRepository } from '../hooks/useRepository';
import { getConfig } from '../config';
import { Role } from '../types/chat';
import { WorkflowNode } from './WorkflowNode';
import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';
import type { FileChunk } from '../hooks/useRepository';

// Helper to format a single repository chunk as markdown
function formatChunkResult(chunk: FileChunk): string {
  const similarity = chunk.similarity ? ` (${(chunk.similarity * 100).toFixed(1)}% match)` : '';
  return `**${chunk.file.name}**${similarity}\n\n${chunk.text}`;
}

// Helper to create structured data from repository chunks
function createRepositoryData(chunks: FileChunk[]): Data<FileChunk> {
  return {
    items: chunks.map((chunk) => ({
      value: chunk,
      text: formatChunkResult(chunk),
    })),
  };
}

// RepositoryNode data interface
export interface RepositoryNodeData extends BaseNodeData {
  repository?: string;
  query?: string;        // Used for direct query input when no connections
  instructions?: string; // Used as guidance when there ARE connections
}

// RepositoryNode type
export type RepositoryNodeType = Node<RepositoryNodeData, 'repository'>;

export const RepositoryNode = memo(({ id, data, selected }: NodeProps<RepositoryNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getText, hasConnections, isProcessing, executeAsync } = useWorkflowNode(id);
  const { repositories } = useRepositories();
  const [activeTab, setActiveTab] = useState(0);
  const config = getConfig();
  const client = config.client;

  // Get the current repository
  const currentRepository = repositories.find(r => r.id === data.repository);
  const { queryChunks } = useRepository(data.repository || '', 'auto');

  const handleExecute = async () => {
    const query = data.query?.trim() || '';
    const instructions = data.instructions?.trim() || '';

    if (!data.repository) {
      updateNode(id, {
        data: { ...data, error: 'No repository selected' }
      });
      return;
    }

    await executeAsync(async () => {
      try {
        let searchQuery = '';

        if (hasConnections) {
          // With input: use LLM to form optimized query from inputs
          const inputText = getText();
          
          try {
            const systemPrompt = instructions
              ? 'Generate a concise and effective search query for a document repository based on the user instructions and the provided context. Return only the search query, nothing else.'
              : 'Generate a concise and effective search query for a document repository based on the provided context. Return only the search query, nothing else.';
            
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

        // Query the repository
        const chunks = await queryChunks(searchQuery, 10);

        // Reset active tab when results change
        setActiveTab(0);

        if (chunks.length === 0) {
          updateNode(id, {
            data: { ...data, output: createRepositoryData([{ file: { id: '', name: 'No Results', status: 'completed', progress: 100, uploadedAt: new Date() }, text: 'No results found for the query' }]), error: undefined }
          });
        } else {
          updateNode(id, {
            data: { ...data, output: createRepositoryData(chunks), error: undefined }
          });
        }
      } catch (error) {
        console.error('Error executing repository query:', error);
        updateNode(id, {
          data: { ...data, error: error instanceof Error ? error.message : 'Unknown error' }
        });
      }
    });
  };

  const canExecute = !!data.repository && (hasConnections || !!data.query?.trim());

  const repositorySelector = (
    <Menu>
      <MenuButton className="nodrag inline-flex items-center gap-1 px-2 py-1 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <ChevronDown size={12} className="opacity-50" />
        <span>
          {currentRepository?.name || 'Repository'}
        </span>
      </MenuButton>
      <MenuItems
        modal={false}
        transition
        anchor="bottom end"
        className="max-h-[50vh]! mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50 min-w-[200px]"
      >
        {repositories.length === 0 ? (
          <div className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
            No repositories available
          </div>
        ) : (
          repositories.map((repo) => (
            <MenuItem key={repo.id}>
              <button
                type="button"
                onClick={() => updateNode(id, { data: { ...data, repository: repo.id } })}
                className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
              >
                {repo.name}
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
      icon={Database}
      title="Repository"
      color="purple"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={canExecute}
      showInputHandle={true}
      showOutputHandle={true}
      error={data.error}
      headerActions={
        <>
          {repositorySelector}
          {data.output && <CopyButton text={getDataText(data.output)} />}
        </>
      }
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        {/* Query Input - only shown when no connections */}
        {!hasConnections ? (
          <div className="shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={data.query ?? ''}
                onChange={(e) => updateNode(id, { 
                  data: { ...data, query: e.target.value } 
                })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && data.query?.trim()) {
                    handleExecute();
                  }
                }}
                placeholder="Enter search query..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 focus:outline-none transition-all nodrag"
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
        ) : (
          <div className="shrink-0">
            <textarea
              value={data.instructions ?? ''}
              onChange={(e) => updateNode(id, { data: { ...data, instructions: e.target.value } })}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Instructions to help form search query from input..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 focus:outline-none transition-all resize-y min-h-[50px] nodrag"
            />
          </div>
        )}

        {/* Output Display */}
        {data.output && data.output.items.length > 1 ? (
          // Multiple results: show with tabs
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-t-lg bg-white/30 dark:bg-black/10 border border-b-0 border-neutral-200 dark:border-neutral-700 prose prose-sm dark:prose-invert max-w-none nodrag scrollbar-hide">
              <Markdown>{data.output.items[activeTab]?.text || ''}</Markdown>
            </div>
            {/* Tab navigation at bottom */}
            <div className="shrink-0 flex items-center justify-between px-2 py-1.5 bg-neutral-200/50 dark:bg-black/20 rounded-b-lg border border-t-0 border-neutral-200 dark:border-neutral-700">
              <button
                onClick={() => setActiveTab(Math.max(0, activeTab - 1))}
                disabled={activeTab === 0}
                className="p-1 rounded hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors nodrag"
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
                        : 'bg-neutral-300/50 dark:bg-neutral-700/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-400/50 dark:hover:bg-neutral-600/50'
                    }`}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setActiveTab(Math.min(data.output!.items.length - 1, activeTab + 1))}
                disabled={activeTab === data.output.items.length - 1}
                className="p-1 rounded hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors nodrag"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ) : data.output && data.output.items.length === 1 ? (
          // Single result
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-1 py-2 text-sm rounded-lg bg-white/30 dark:bg-black/10 border border-neutral-200 dark:border-neutral-700 prose prose-sm dark:prose-invert max-w-none nodrag scrollbar-hide">
              <Markdown>{data.output.items[0].text}</Markdown>
            </div>
          </div>
        ) : null}
      </div>
    </WorkflowNode>
  );
});
