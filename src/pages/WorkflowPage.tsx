import { WorkflowProvider } from '../contexts/WorkflowProvider';
import { WorkflowPalette } from '../components/WorkflowPalette';
import { WorkflowCanvas } from '../components/WorkflowCanvas';

export function WorkflowPage() {
  return (
    <WorkflowProvider>
      <div className="h-full w-full flex overflow-hidden relative">
        <WorkflowCanvas />
        <WorkflowPalette />
      </div>
    </WorkflowProvider>
  );
}
