import { memo, useState, useRef, useEffect } from 'react';
import { StickyNote } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData } from '@/features/workflow/types/workflow';
import { createData } from '@/features/workflow/types/workflow';
import { useWorkflow } from '@/features/workflow/hooks/useWorkflow';
import { WorkflowNode } from '@/features/workflow/components/WorkflowNode';

// TextNode data interface
export interface TextNodeData extends BaseNodeData {
  outputText?: string;  // Legacy property, kept for backward compatibility
}

// TextNode type
export type TextNodeType = Node<TextNodeData, 'text'>;

export const TextNode = memo(({ id, data, selected }: NodeProps<TextNodeType>) => {
  const { updateNode } = useWorkflow();
  // Support both old 'outputText' format and new 'output' format
  const currentText = data.output?.items?.[0]?.text ?? data.outputText ?? '';
  const [localValue, setLocalValue] = useState(currentText);
  const isLocalChangeRef = useRef(false);

  // Sync local state with external updates (but not our own changes)
  useEffect(() => {
    // Skip if this update was triggered by local changes
    if (isLocalChangeRef.current) {
      isLocalChangeRef.current = false;
      return;
    }
    setLocalValue(currentText);
  }, [currentText]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    isLocalChangeRef.current = true;
    // Write to both formats for compatibility
    updateNode(id, { data: { ...data, output: createData(newValue), outputText: newValue } });
  };

  // Ensure output is always set (handles initial mount with empty output or migration from old format)
  useEffect(() => {
    if (localValue && !data.output) {
      isLocalChangeRef.current = true;
      updateNode(id, { data: { ...data, output: createData(localValue), outputText: localValue } });
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={StickyNote}
      title="Text"
      color="orange"
      showInputHandle={false}
      showOutputHandle={true}
      error={data.error}
    >
      <div className="flex-1 flex flex-col min-h-0">
        <textarea
          value={localValue}
          onChange={handleChange}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="Enter your text here..."
          className="w-full h-full p-3 text-sm border-0 bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none resize-none nodrag"
        />
      </div>
    </WorkflowNode>
  );
});
