import { memo } from 'react';
import { StickyNote } from 'lucide-react';
import { Textarea } from '@headlessui/react';
import type { NodeProps } from '@xyflow/react';
import type { TextNode as TextNodeType } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { WorkflowNode } from './WorkflowNode';

export const TextNode = memo(({ id, data, selected }: NodeProps<TextNodeType>) => {
  const { updateNode } = useWorkflow();

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={StickyNote}
      title="Text"
      color="orange"
      showInputHandle={false}
      showOutputHandle={true}
    >
      <div className="flex-1 flex flex-col min-h-0">
        <Textarea
          value={data.content || ''}
          onChange={(e) => updateNode(id, { 
            data: { ...data, content: e.target.value } 
          })}
          placeholder="Enter your text here..."
          className="w-full h-full px-1 py-2 text-sm border-0 rounded-none bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none transition-all resize-none min-h-[120px] scrollbar-hide nodrag"
        />
      </div>
    </WorkflowNode>
  );
});
