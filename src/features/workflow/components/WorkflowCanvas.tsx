import { 
  ReactFlow, 
  Background, 
  Controls, 
  BackgroundVariant,
  type NodeTypes,
  type Edge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useRef } from 'react';
import { useWorkflow } from '@/features/workflow/hooks/useWorkflow';
import { useTheme } from '@/shell/hooks/useTheme';
import { SearchNode } from '@/features/workflow/nodes/SearchNode';
import { PromptNode } from '@/features/workflow/nodes/PromptNode';
import { TranslateNode } from '@/features/workflow/nodes/TranslateNode';
import { FileNode } from '@/features/workflow/nodes/FileNode';
import { TextNode } from '@/features/workflow/nodes/TextNode';
import { RepositoryNode } from '@/features/workflow/nodes/RepositoryNode';
import { MarkdownNode } from '@/features/workflow/nodes/MarkdownNode';
import { AudioNode } from '@/features/workflow/nodes/AudioNode';
import { ImageNode } from '@/features/workflow/nodes/ImageNode';
import { CsvNode } from '@/features/workflow/nodes/CsvNode';
import { CodeNode } from '@/features/workflow/nodes/CodeNode';

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
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, deleteConnection } = useWorkflow();
  const { isDark } = useTheme();
  const lastClickedEdge = useRef<{ id: string; time: number } | null>(null);

  // Double-click to delete edge
  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    const now = Date.now();
    const lastClick = lastClickedEdge.current;
    
    if (lastClick && lastClick.id === edge.id && now - lastClick.time < 300) {
      // Double-click detected - delete the edge
      deleteConnection(edge.id);
      lastClickedEdge.current = null;
    } else {
      // First click - record it
      lastClickedEdge.current = { id: edge.id, time: now };
    }
  }, [deleteConnection]);

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
    </div>
  );
}
