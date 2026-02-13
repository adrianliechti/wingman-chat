import { useEffect } from 'react';
import { Plus as PlusIcon } from 'lucide-react';
import { WorkflowProvider } from '@/features/workflow/context/WorkflowProvider';
import { WorkflowPalette } from '@/features/workflow/components/WorkflowPalette';
import { WorkflowCanvas } from '@/features/workflow/components/WorkflowCanvas';
import { useNavigation } from '@/shell/hooks/useNavigation';
import { useWorkflow } from '@/features/workflow/hooks/useWorkflow';

function WorkflowPageContent() {
  const { setRightActions } = useNavigation();
  const { clearWorkflow } = useWorkflow();

  useEffect(() => {
    setRightActions(
      <>
        <button
          type="button"
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
          onClick={clearWorkflow}
        >
          <PlusIcon size={20} />
        </button>
      </>
    );

    // Cleanup when component unmounts
    return () => {
      setRightActions(null);
    };
  }, [setRightActions, clearWorkflow]);

  return (
    <div className="h-full w-full flex overflow-hidden relative">
      <WorkflowCanvas />
      <WorkflowPalette />
    </div>
  );
}

export function WorkflowPage() {
  return (
    <WorkflowProvider>
      <WorkflowPageContent />
    </WorkflowProvider>
  );
}
