import { Globe, Sparkles, FileText, FileType, Volume2, Image, StickyNote, Languages, Table, Database, Code2 } from 'lucide-react';
import { useWorkflow } from '../hooks/useWorkflow';
import type { Node } from '@xyflow/react';
import { useState, useEffect, useRef } from 'react';
import { getConfig } from '../config';
import { createSearchNode } from './SearchNode.factory';
import { createPromptNode } from './PromptNode.factory';
import { createTextNode } from './TextNode.factory';
import { createFileNode } from './FileNode.factory';
import { createCodeNode } from './CodeNode.factory';
import { createTranslateNode } from './TranslateNode.factory';
import { createRepositoryNode } from './RepositoryNode.factory';
import { createMarkdownNode } from './MarkdownNode.factory';
import { createAudioNode } from './AudioNode.factory';
import { createImageNode } from './ImageNode.factory';
import { createCsvNode } from './CsvNode.factory';

type NodeFactory = (position: { x: number; y: number }) => Node;

interface WorkflowPaletteItemProps {
  label: string;
  icon: React.ReactNode;
  createNode: NodeFactory;
}

function WorkflowPaletteItem({ label, icon, createNode }: WorkflowPaletteItemProps) {
  const { addNode } = useWorkflow();

  const handleClick = () => {
    // Calculate position: center of the screen
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const nodeWidth = 400;
    const nodeHeight = 300;
    
    // Center position minus half the node size to center the node itself
    const x = (viewportWidth - nodeWidth) / 2;
    const y = (viewportHeight - nodeHeight) / 2;
    
    const newNode = createNode({ x, y });
    
    // Apply standard dimensions
    newNode.style = {
      width: nodeWidth,
      height: nodeHeight
    };

    addNode(newNode);
  };

  return (
    <button
      onClick={handleClick}
      title={label}
      className="size-10 bg-transparent dark:bg-transparent rounded-lg flex items-center justify-center hover:bg-neutral-200 dark:hover:bg-white/10 transition-all text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
    >
      {icon}
    </button>
  );
}

export function WorkflowPalette() {
  const [useDoubleColumn, setUseDoubleColumn] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const config = getConfig();

  useEffect(() => {
    const checkHeight = () => {
      const availableHeight = window.innerHeight - 128; // 8rem = 128px for top/bottom spacing
      const estimatedSingleColumnHeight = 11 * 48 + 2 * 8; // ~11 items * 48px + 2 dividers
      setUseDoubleColumn(estimatedSingleColumnHeight > availableHeight);
    };

    checkHeight();
    window.addEventListener('resize', checkHeight);
    return () => window.removeEventListener('resize', checkHeight);
  }, []);

  return (
    <div 
      ref={containerRef}
      className="absolute left-4 top-[calc(50%+1rem)] -translate-y-1/2 z-10 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-xl border border-white/40 dark:border-white/25 shadow-lg p-2 max-h-[calc(100vh-8rem)] overflow-y-auto"
    >
      <div className={`grid ${useDoubleColumn ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
        <WorkflowPaletteItem
          label="Text"
          icon={<StickyNote size={20} />}
          createNode={createTextNode}
        />
        <WorkflowPaletteItem
          label="File"
          icon={<FileText size={20} />}
          createNode={createFileNode}
        />
        {config.internet?.enabled && (
          <WorkflowPaletteItem
            label="Search"
            icon={<Globe size={20} />}
            createNode={createSearchNode}
          />
        )}
        {config.repository?.enabled && (
          <WorkflowPaletteItem
            label="Repository"
            icon={<Database size={20} />}
            createNode={createRepositoryNode}
          />
        )}
      </div>
      <div className="w-full h-px bg-gray-300/50 dark:bg-gray-600/50 my-1" />
      <div className={`grid ${useDoubleColumn ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
        <WorkflowPaletteItem
          label="Prompt"
          icon={<Sparkles size={20} />}
          createNode={createPromptNode}
        />
        {config.interpreter?.enabled && (
          <WorkflowPaletteItem
            label="Code"
            icon={<Code2 size={20} />}
            createNode={createCodeNode}
          />
        )}
        {config.translator?.enabled && (
          <WorkflowPaletteItem
            label="Translate"
            icon={<Languages size={20} />}
            createNode={createTranslateNode}
          />
        )}
      </div>
      <div className="w-full h-px bg-gray-300/50 dark:bg-gray-600/50 my-1" />
      <div className={`grid ${useDoubleColumn ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
        <WorkflowPaletteItem
          label="Markdown"
          icon={<FileType size={20} />}
          createNode={createMarkdownNode}
        />
        {config.tts && (
          <WorkflowPaletteItem
            label="Audio"
            icon={<Volume2 size={20} />}
            createNode={createAudioNode}
          />
        )}
        {config.renderer?.enabled && (
          <WorkflowPaletteItem
            label="Image"
            icon={<Image size={20} />}
            createNode={createImageNode}
          />
        )}
        <WorkflowPaletteItem
          label="CSV"
          icon={<Table size={20} />}
          createNode={createCsvNode}
        />
      </div>
    </div>
  );
}
