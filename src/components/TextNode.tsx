import { memo, useState, useEffect } from 'react';
import { StickyNote } from 'lucide-react';
import { Textarea } from '@headlessui/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { WorkflowNode } from './WorkflowNode';

// TextNode data interface
export interface TextNodeData extends BaseNodeData {
}

// TextNode type
export type TextNodeType = Node<TextNodeData, 'text'>;

// Factory function to create a new TextNode
export function createTextNode(position: { x: number; y: number }): TextNodeType {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    position,
    data: {
      outputText: '',
      useInput: false
    }
  };
}

export const TextNode = memo(({ id, data, selected }: NodeProps<TextNodeType>) => {
  const { updateNode } = useWorkflow();
  const [content, setContent] = useState(data.outputText || '');

  useEffect(() => {
    setContent(data.outputText || '');
  }, [data.outputText]);

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
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={() => updateNode(id, { data: { ...data, outputText: content } })}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="Enter your text here..."
          className="w-full h-full px-1 py-2 text-sm border-0 rounded-none bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none transition-all resize-none min-h-[120px] scrollbar-hide nodrag"
        />
      </div>
    </WorkflowNode>
  );
});
