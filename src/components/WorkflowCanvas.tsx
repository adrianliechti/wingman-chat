import { 
  ReactFlow, 
  Background, 
  Controls, 
  BackgroundVariant,
  type NodeTypes,
  type Edge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useState, useCallback, useMemo } from 'react';
import { useWorkflow } from '../hooks/useWorkflow';
import { useTheme } from '../hooks/useTheme';
import { SearchNode } from './SearchNode';
import { PromptNode } from './PromptNode';
import { TranslateNode } from './TranslateNode';
import { FileNode } from './FileNode';
import { TextNode } from './TextNode';
import { RepositoryNode } from './RepositoryNode';
import { MarkdownNode } from './MarkdownNode';
import { AudioNode } from './AudioNode';
import { ImageNode } from './ImageNode';
import { CsvNode } from './CsvNode';
import { CodeNode } from './CodeNode';
import { WorkflowLabelDialog } from './WorkflowLabelDialog';
import type { WorkflowEdge } from '../types/workflow';

// Move nodeTypes outside component to prevent recreating on every render
const nodeTypes: NodeTypes = {
  search: SearchNode,
  prompt: PromptNode,
  translate: TranslateNode,
  file: FileNode,
  text: TextNode,
  repository: RepositoryNode,
  markdown: MarkdownNode,
  audio: AudioNode,
  image: ImageNode,
  csv: CsvNode,
  code: CodeNode,
};

// Move defaultEdgeOptions outside to prevent recreating
const defaultEdgeOptions = {
  style: { strokeWidth: 2 },
};

export function WorkflowCanvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, updateEdgeLabel, deleteConnection } = useWorkflow();
  const { isDark } = useTheme();
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Memoize callbacks to prevent recreating on every render
  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge);
    setIsDialogOpen(true);
  }, []);

  const handleSaveLabel = useCallback((label: string) => {
    if (selectedEdge) {
      updateEdgeLabel(selectedEdge.id, label);
    }
  }, [selectedEdge, updateEdgeLabel]);

  const handleDeleteEdge = useCallback(() => {
    if (selectedEdge) {
      deleteConnection(selectedEdge.id);
    }
  }, [selectedEdge, deleteConnection]);

  const handleCloseDialog = useCallback(() => {
    setIsDialogOpen(false);
  }, []);

  // Memoize the current label to prevent recalculating
  const currentLabel = useMemo(() => 
    (selectedEdge as WorkflowEdge)?.data?.label || '', 
    [selectedEdge]
  );

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={handleEdgeClick}
        nodeTypes={nodeTypes}
        colorMode={isDark ? 'dark' : 'light'}
        proOptions={{ hideAttribution: true }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        className="bg-gray-50 dark:bg-gray-900"
        edgesReconnectable={true}
        edgesFocusable={true}
        elevateNodesOnSelect={true}
        defaultEdgeOptions={defaultEdgeOptions}
      >
        <Background 
          variant={BackgroundVariant.Dots} 
          gap={16} 
          size={1}
          className="bg-gray-50 dark:bg-gray-900"
        />
        <Controls 
          orientation="horizontal"
          showInteractive={false}
          position="bottom-right"
          className="bg-white/90 dark:bg-black/40 backdrop-blur-lg border border-white/40 dark:border-white/20 rounded-lg"
        />
      </ReactFlow>

      <WorkflowLabelDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        currentLabel={currentLabel}
        onSave={handleSaveLabel}
        onDelete={handleDeleteEdge}
      />
    </div>
  );
}
