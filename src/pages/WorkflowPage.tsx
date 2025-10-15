import { WorkflowProvider } from '../contexts/WorkflowProvider';
import { NodePalette } from '../components/NodePalette';
import { WorkflowCanvas } from '../components/WorkflowCanvas';

export function WorkflowPage() {
  return (
    <WorkflowProvider>
      <div className="h-full w-full flex overflow-hidden relative">
        <WorkflowCanvas />
        <NodePalette />
      </div>
    </WorkflowProvider>
  );
}
