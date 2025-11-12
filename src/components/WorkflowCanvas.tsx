import { 
  ReactFlow, 
  Background, 
  Controls, 
  BackgroundVariant,
  type NodeTypes,
  type Edge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useState } from 'react';
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

export function WorkflowCanvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, updateEdgeLabel, deleteConnection } = useWorkflow();
  const { isDark } = useTheme();
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleEdgeClick = (_event: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge);
    setIsDialogOpen(true);
  };

  const handleSaveLabel = (label: string) => {
    if (selectedEdge) {
      updateEdgeLabel(selectedEdge.id, label);
    }
  };

  const handleDeleteEdge = () => {
    if (selectedEdge) {
      deleteConnection(selectedEdge.id);
    }
  };

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
        defaultEdgeOptions={{
          style: { strokeWidth: 2 },
        }}
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
        onClose={() => setIsDialogOpen(false)}
        currentLabel={(selectedEdge as WorkflowEdge)?.data?.label || ''}
        onSave={handleSaveLabel}
        onDelete={handleDeleteEdge}
      />
    </div>
  );
}
