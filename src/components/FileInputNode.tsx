import { memo, useState, useRef } from 'react';
import { FileText, Upload, Loader2 } from 'lucide-react';
import { Textarea } from '@headlessui/react';
import type { NodeProps } from '@xyflow/react';
import type { FileInputNode as FileInputNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { getConfig } from '../config';
import { supportedTypes } from '../lib/utils';
import { WorkflowNode } from './WorkflowNode';

export const FileInputNode = memo(({ id, data, selected }: NodeProps<FileInputNodeType>) => {
  const { updateNode } = useWorkflow();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const config = getConfig();
  const client = config.client;

  const processFile = async (file: File) => {
    setIsLoading(true);
    try {
      const content = await client.extractText(file);
      updateNode(id, {
        data: {
          ...data,
          fileName: file.name,
          fileContent: content,
          outputText: content
        }
      });
    } catch (error) {
      console.error('Error extracting text from file:', error);
      updateNode(id, {
        data: {
          ...data,
          fileName: file.name,
          fileContent: 'Error extracting text from file',
          outputText: ''
        }
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={FileText}
      title="File Input"
      color="orange"
      showInputHandle={false}
      showOutputHandle={true}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={supportedTypes.join(",")}
        onChange={handleFileUpload}
        className="hidden"
        disabled={isLoading}
      />
      
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-gray-500 dark:text-gray-400">
            <Loader2 size={40} className="animate-spin" strokeWidth={1.5} />
            <span className="text-sm">Extracting text...</span>
          </div>
        </div>
      ) : !data.fileContent ? (
        <div 
          className="flex-1 flex items-center justify-center"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center gap-3 p-8 text-gray-400 dark:text-gray-600 hover:text-orange-500 dark:hover:text-orange-400 transition-colors nodrag group ${
              isDragging ? 'text-orange-500 dark:text-orange-400 scale-105' : ''
            }`}
          >
            <Upload size={56} strokeWidth={1.5} className="group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium">
              {isDragging ? 'Drop file here' : 'Click to upload file'}
            </span>
          </button>
        </div>
      ) : (
        <div 
          className="flex-1 flex flex-col min-h-0 gap-2"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex-shrink-0 px-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-3 py-1.5 text-xs border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-600 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-black/30 hover:text-orange-600 dark:hover:text-orange-400 transition-all flex items-center justify-center gap-1.5 nodrag"
            >
              <Upload size={12} />
              Replace file
            </button>
          </div>
          <div className={`flex-1 flex flex-col min-h-0 px-2 pb-2 transition-all ${
            isDragging ? 'opacity-50' : ''
          }`}>
            <Textarea
              value={data.fileContent || ''}
              readOnly
              className="w-full h-full px-3 py-2 text-xs border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-gray-100/50 dark:bg-black/10 text-gray-700 dark:text-gray-300 resize-none min-h-[80px] scrollbar-hide nowheel"
            />
          </div>
        </div>
      )}
    </WorkflowNode>
  );
});
