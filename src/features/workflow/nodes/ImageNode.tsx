import { memo, useState, useEffect } from 'react';
import { ImageIcon, ChevronDown } from 'lucide-react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData } from '@/features/workflow/types/workflow';
import type { Model } from '@/shared/types/chat';
import { useWorkflow } from '@/features/workflow/hooks/useWorkflow';
import { useWorkflowNode } from '@/features/workflow/hooks/useWorkflowNode';
import { getConfig } from '@/shared/config';
import { WorkflowNode } from '@/features/workflow/components/WorkflowNode';
import { DownloadButton } from '@/shared/ui/DownloadButton';

// ImageNode data interface
export interface ImageNodeData extends BaseNodeData {
  imageUrl?: string;
  model?: string;
}

// ImageNode type
export type ImageNodeType = Node<ImageNodeData, 'image'>;

export const ImageNode = memo(({ id, data, selected }: NodeProps<ImageNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getText, hasConnections, isProcessing, executeAsync } = useWorkflowNode(id);
  const [models, setModels] = useState<Model[]>([]);
  const config = getConfig();
  const client = config.client;

  useEffect(() => {
    const loadModels = async () => {
      try {
        const modelList = await client.listModels("renderer");
        setModels(modelList);
      } catch (error) {
        console.error('Error loading models:', error);
      }
    };
    loadModels();
  }, [client]);

  const handleExecute = async () => {
    // Get input from connected nodes
    const inputContent = getText();
    
    if (!inputContent) return;
    
    await executeAsync(async () => {
      // Clear any previous error when starting a new execution
      updateNode(id, {
        data: { ...data, error: undefined }
      });
      
      try {
        // Generate image from the input text (prompt)
        const model = data.model || config.renderer?.model || '';
        const imageBlob = await client.generateImage(model, inputContent);
        
        // Create a URL for the image blob
        const imageUrl = URL.createObjectURL(imageBlob);
        
        // Update node with the image URL (and clear error)
        updateNode(id, {
          data: { ...data, imageUrl, error: undefined }
        });
      } catch (error) {
        console.error('Error generating image:', error);
        updateNode(id, {
          data: { 
            ...data, 
            imageUrl: undefined,
            error: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` 
          }
        });
      }
    });
  };

  const currentModel = models.find(m => m.id === data.model);

  const modelSelector = (
    <Menu>
      <MenuButton className="nodrag inline-flex items-center gap-1 px-2 py-1 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <ChevronDown size={12} className="opacity-50" />
        <span>
          {currentModel?.name || 'Default'}
        </span>
      </MenuButton>
      <MenuItems
        modal={false}
        transition
        anchor="bottom end"
        className="max-h-[50vh]! mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50 min-w-[200px]"
      >
        {models.length === 0 ? (
          <div className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
            No models available
          </div>
        ) : (
          models.map((model) => (
            <MenuItem key={model.id}>
              <button
                type="button"
                onClick={() => updateNode(id, { data: { ...data, model: model.id } })}
                className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
              >
                {model.name}
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
      icon={ImageIcon}
      title="Image"
      color="red"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={hasConnections}
      showInputHandle={true}
      showOutputHandle={false}
      minWidth={400}
      error={data.error}
      headerActions={
        <>
          {modelSelector}
          {data.imageUrl && <DownloadButton url={data.imageUrl} filename="generated-image.png" />}
        </>
      }
    >
      <div className="flex-1 flex flex-col min-h-0">
        {data.error ? (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-600 dark:text-red-400 text-sm">{data.error}</p>
          </div>
        ) : data.imageUrl ? (
          <div className="flex-1 rounded-lg overflow-hidden bg-white dark:bg-black/20">
            <img 
              src={data.imageUrl} 
              alt="Generated output"
              className="w-full h-full object-contain"
              onError={() => {
                updateNode(id, {
                  data: { ...data, error: 'Failed to load image' }
                });
              }}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 dark:text-gray-600">
            <ImageIcon size={48} strokeWidth={1} />
            <div className="grid grid-cols-3 gap-1">
              <div className="w-8 h-8 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
              <div className="w-8 h-8 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
              <div className="w-8 h-8 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
              <div className="w-8 h-8 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
              <div className="w-8 h-8 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
              <div className="w-8 h-8 bg-gray-300/30 dark:bg-gray-700/30 rounded" />
            </div>
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});
