import type { ReactNode } from 'react';
import { Trash2, Play, Loader2, AlertCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { useWorkflow } from '../hooks/useWorkflow';

export interface WorkflowNodeProps {
  id: string;
  selected: boolean;
  icon: LucideIcon;
  title: string;
  color: 'blue' | 'purple' | 'green' | 'orange' | 'red';
  children: ReactNode;
  onExecute?: () => void | Promise<void>;
  isProcessing?: boolean;
  canExecute?: boolean;
  showInputHandle?: boolean;
  showOutputHandle?: boolean;
  minWidth?: number;
  minHeight?: number;
  headerActions?: ReactNode;
  error?: string;
}

const colorStyles = {
  blue: {
    border: 'border-blue-500/50',
    icon: 'text-blue-500 dark:text-blue-400',
    button: 'text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300'
  },
  purple: {
    border: 'border-purple-500/50',
    icon: 'text-purple-500 dark:text-purple-400',
    button: 'text-purple-500 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-300'
  },
  green: {
    border: 'border-green-500/50',
    icon: 'text-green-500 dark:text-green-400',
    button: 'text-green-500 hover:text-green-600 dark:text-green-400 dark:hover:text-green-300'
  },
  orange: {
    border: 'border-orange-500/50',
    icon: 'text-orange-500 dark:text-orange-400',
    button: 'text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300'
  },
  red: {
    border: 'border-red-500/50',
    icon: 'text-red-500 dark:text-red-400',
    button: 'text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300'
  }
};

export function WorkflowNode({
  id,
  selected,
  icon: Icon,
  title,
  color,
  children,
  onExecute,
  isProcessing = false,
  canExecute = true,
  showInputHandle = true,
  showOutputHandle = true,
  minWidth = 280,
  minHeight = 200,
  headerActions,
  error
}: WorkflowNodeProps) {
  const { deleteNode } = useWorkflow();
  const styles = colorStyles[color];

  return (
    <div
      className={`bg-white/90 dark:bg-black/40 backdrop-blur-lg rounded-2xl shadow-lg border ${
        error ? 'border-red-500/70' : selected ? styles.border : 'border-white/40 dark:border-white/20'
      } p-4 flex flex-col w-full h-full overflow-hidden nowheel`}
    >
      <NodeResizer 
        minWidth={minWidth} 
        minHeight={minHeight}
        isVisible={selected}
        lineStyle={{ borderColor: 'transparent', borderWidth: 10 }}
        handleStyle={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'transparent' }}
      />
      
      {/* Input Handle */}
      {showInputHandle && (
        <Handle
          type="target"
          position={Position.Left}
          className="w-3! h-3! bg-green-500! border-2! border-white! dark:border-gray-800!"
        />
      )}
      
      {/* Output Handle */}
      {showOutputHandle && (
        <Handle
          type="source"
          position={Position.Right}
          className="w-3! h-3! bg-blue-500! border-2! border-white! dark:border-gray-800!"
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Icon size={16} className={styles.icon} />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          <button
            onClick={() => deleteNode(id)}
            className="text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
          {onExecute && (
            <button
              onClick={onExecute}
              disabled={isProcessing || !canExecute}
              className={`${styles.button} transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
              title="Execute"
            >
              {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2 shrink-0">
          <AlertCircle size={16} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
          <span className="text-xs text-red-700 dark:text-red-300 wrap-break-word">{error}</span>
        </div>
      )}

      {/* Node-specific content */}
      {children}
    </div>
  );
}
