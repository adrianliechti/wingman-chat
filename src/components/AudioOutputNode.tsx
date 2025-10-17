import { memo } from 'react';
import { Volume2 } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import type { AudioOutputNode as AudioOutputNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';

export const AudioOutputNode = memo(({ id, data, selected }: NodeProps<AudioOutputNodeType>) => {
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
        // Generate audio from the input text
        const audioBlob = await client.generateAudio('', inputContent);
        
        // Create a URL for the audio blob
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Update node with the audio URL (and clear error)
        updateNode(id, {
          data: { ...data, audioUrl, error: undefined }
        });
      } catch (error) {
        console.error('Error generating audio:', error);
        updateNode(id, {
          data: { 
            ...data, 
            audioUrl: undefined,
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
      icon={Volume2}
      title="Audio Output"
      color="blue"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={hasConnections}
      showInputHandle={true}
      showOutputHandle={false}
      minWidth={350}
    >
      <div className="flex-1 flex items-center justify-center min-h-0 p-4">
        {data.error ? (
          <div className="w-full px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-600 dark:text-red-400 text-sm">{data.error}</p>
          </div>
        ) : data.audioUrl ? (
          <div className="w-full px-3 py-2 border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white dark:bg-black/20">
            <audio 
              controls 
              src={data.audioUrl}
              className="w-full"
              onError={() => {
                updateNode(id, {
                  data: { ...data, error: 'Failed to load audio' }
                });
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 text-gray-400 dark:text-gray-600">
            <Volume2 size={48} strokeWidth={1} />
            <div className="flex gap-1 items-end">
              <div className="w-1 h-4 bg-gray-300/30 dark:bg-gray-700/30 rounded-full" />
              <div className="w-1 h-8 bg-gray-300/30 dark:bg-gray-700/30 rounded-full" />
              <div className="w-1 h-6 bg-gray-300/30 dark:bg-gray-700/30 rounded-full" />
              <div className="w-1 h-10 bg-gray-300/30 dark:bg-gray-700/30 rounded-full" />
              <div className="w-1 h-5 bg-gray-300/30 dark:bg-gray-700/30 rounded-full" />
              <div className="w-1 h-7 bg-gray-300/30 dark:bg-gray-700/30 rounded-full" />
              <div className="w-1 h-4 bg-gray-300/30 dark:bg-gray-700/30 rounded-full" />
            </div>
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});
