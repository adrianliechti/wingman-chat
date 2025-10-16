import { 
  ReactFlow, 
  Background, 
  Controls, 
  BackgroundVariant,
  type NodeTypes
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflow } from '../hooks/useWorkflow';
import { useTheme } from '../hooks/useTheme';
import { SearchInputNode } from './SearchInputNode';
import { PromptNode } from './PromptNode';
import { TranslateNode } from './TranslateNode';
import { FileInputNode } from './FileInputNode';
import { WebInputNode } from './WebInputNode';
import { TextInputNode } from './TextInputNode';
import { RepositoryInputNode } from './RepositoryInputNode';
import { MarkdownOutputNode } from './MarkdownOutputNode';
import { AudioOutputNode } from './AudioOutputNode';
import { ImageOutputNode } from './ImageOutputNode';
import { CsvOutputNode } from './CsvOutputNode';

const nodeTypes: NodeTypes = {
  searchInput: SearchInputNode,
  llm: PromptNode,
  translate: TranslateNode,
  fileInput: FileInputNode,
  webInput: WebInputNode,
  textInput: TextInputNode,
  repositoryInput: RepositoryInputNode,
  markdownOutput: MarkdownOutputNode,
  audioOutput: AudioOutputNode,
  imageOutput: ImageOutputNode,
  csvOutput: CsvOutputNode,
};

export function WorkflowCanvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } = useWorkflow();
  const { isDark } = useTheme();

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        colorMode={isDark ? 'dark' : 'light'}
        proOptions={{ hideAttribution: true }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        className="bg-gray-50 dark:bg-gray-900"
        edgesReconnectable={true}
        edgesFocusable={true}
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: '#3b82f6', strokeWidth: 2 },
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
    </div>
  );
}
