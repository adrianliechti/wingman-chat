import { memo } from 'react';
import { ImageIcon } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import type { ImageNode as ImageNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';
import { DownloadButton } from './DownloadButton';

export const ImageNode = memo(({ id, data, selected }: NodeProps<ImageNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getText, hasConnections, isProcessing, executeAsync } = useWorkflowNode(id);
  const config = getConfig();
  const client = config.client;

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
        const model = config.image?.model || '';
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
      headerActions={
        data.imageUrl && <DownloadButton url={data.imageUrl} filename="generated-image.png" />
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
