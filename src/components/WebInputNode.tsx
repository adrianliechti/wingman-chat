import { memo } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { Input } from '@headlessui/react';
import type { NodeProps } from '@xyflow/react';
import type { WebInputNode as WebInputNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';
import { Markdown } from './Markdown';

export const WebInputNode = memo(({ id, data, selected }: NodeProps<WebInputNodeType>) => {
  const { updateNode } = useWorkflow();
  const { isProcessing, executeAsync } = useWorkflowNode(id);
  const config = getConfig();
  const client = config.client;

  const handleFetchUrl = async () => {
    if (!data.url?.trim()) return;

    await executeAsync(async () => {
      try {
        const content = await client.fetchText(data.url!);
        updateNode(id, {
          data: {
            ...data,
            outputText: content
          }
        });
      } catch (error) {
        console.error('Error fetching URL:', error);
        updateNode(id, {
          data: {
            ...data,
            outputText: `Error fetching URL: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        });
      }
    });
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateNode(id, { 
      data: { ...data, url: e.target.value } 
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && data.url?.trim()) {
      handleFetchUrl();
    }
  };

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Globe}
      title="Web Input"
      color="blue"
      showInputHandle={false}
      showOutputHandle={true}
    >
      {isProcessing ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-gray-500 dark:text-gray-400">
            <Loader2 size={40} className="animate-spin" strokeWidth={1.5} />
            <span className="text-sm">Fetching content...</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 gap-2">
          <div className="flex-shrink-0">
            <div className="flex gap-2">
              <Input
                type="url"
                value={data.url || ''}
                onChange={handleUrlChange}
                onKeyDown={handleKeyDown}
                placeholder="https://example.com"
                className="flex-1 px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 focus:outline-none transition-all nodrag"
              />
              <button
                onClick={handleFetchUrl}
                disabled={!data.url?.trim()}
                className="px-4 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 dark:hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 nodrag"
              >
                Fetch
              </button>
            </div>
          </div>

          {data.outputText && (
            <div className="flex-1 flex flex-col min-h-0 pb-2">
              <div className="flex-1 overflow-y-auto px-3 py-2 text-sm rounded-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide nowheel">
                <Markdown>{data.outputText}</Markdown>
              </div>
            </div>
          )}
        </div>
      )}
    </WorkflowNode>
  );
});
