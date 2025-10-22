import { Globe, Sparkles, FileText, FileType, Volume2, Image, StickyNote, Languages, Table, Database } from 'lucide-react';
import { useWorkflow } from '../hooks/useWorkflow';
import type { NodeType, WorkflowNode } from '../types/workflow';
import { useState, useEffect, useRef } from 'react';
import { getConfig } from '../config';

interface WorkflowPaletteItemProps {
  type: NodeType;
  label: string;
  icon: React.ReactNode;
  onClick: (type: NodeType) => void;
}

function WorkflowPaletteItem({ type, label, icon, onClick }: WorkflowPaletteItemProps) {
  return (
    <button
      onClick={() => onClick(type)}
      title={label}
      className="size-10 bg-transparent dark:bg-transparent rounded-lg flex items-center justify-center hover:bg-neutral-200 dark:hover:bg-white/10 transition-all text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
    >
      {icon}
    </button>
  );
}

export function WorkflowPalette() {
  const { addNode } = useWorkflow();
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

  const handleNodeClick = (type: NodeType) => {
    // Calculate position: center of the screen
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const nodeWidth = 400;
    const nodeHeight = 300;
    
    // Center position minus half the node size to center the node itself
    const x = (viewportWidth - nodeWidth) / 2;
    const y = (viewportHeight - nodeHeight) / 2;
    
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type,
      position: { x, y },
      style: {
        width: 400,
        height: 300
      },
      data: type === 'search' 
        ? { inputText: '', outputText: '', useInput: false }
        : type === 'prompt'
        ? { inputText: '', outputText: '', useInput: false, prompt: '' }
        : type === 'translate'
        ? { outputText: '', useInput: false, language: 'en', tone: '', style: '' }
        : type === 'file'
        ? { fileName: '', fileContent: '', outputText: '', useInput: false }
        : type === 'text'
        ? { content: '', useInput: false }
        : type === 'repository'
        ? { repositoryId: '', query: '', outputText: '', useInput: false }
        : type === 'markdown'
        ? { inputText: '', outputText: '', error: undefined, useInput: false }
        : type === 'audio'
        ? { audioUrl: undefined, error: undefined, useInput: false }
        : type === 'image'
        ? { imageUrl: undefined, error: undefined, useInput: false }
        : type === 'csv'
        ? { csvData: undefined, error: undefined, useInput: false }
        : { inputText: '', outputText: '', useInput: false }
    } as WorkflowNode;

    addNode(newNode);
  };

  return (
    <div 
      ref={containerRef}
      className="absolute left-4 top-[calc(50%+1rem)] -translate-y-1/2 z-10 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-xl border border-white/40 dark:border-white/25 shadow-lg p-2 max-h-[calc(100vh-8rem)] overflow-y-auto"
    >
      <div className={`grid ${useDoubleColumn ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
        <WorkflowPaletteItem
          type="text"
          label="Text"
          icon={<StickyNote size={20} />}
          onClick={handleNodeClick}
        />
        <WorkflowPaletteItem
          type="file"
          label="File"
          icon={<FileText size={20} />}
          onClick={handleNodeClick}
        />
        {config.internet?.enabled && (
          <WorkflowPaletteItem
            type="search"
            label="Search"
            icon={<Globe size={20} />}
            onClick={handleNodeClick}
          />
        )}
        {config.repository?.enabled && (
          <WorkflowPaletteItem
            type="repository"
            label="Repository"
            icon={<Database size={20} />}
            onClick={handleNodeClick}
          />
        )}
      </div>
      <div className="w-full h-px bg-gray-300/50 dark:bg-gray-600/50 my-1" />
      <div className={`grid ${useDoubleColumn ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
        <WorkflowPaletteItem
          type="prompt"
          label="Prompt"
          icon={<Sparkles size={20} />}
          onClick={handleNodeClick}
        />
        {config.translator?.enabled && (
          <WorkflowPaletteItem
            type="translate"
            label="Translate"
            icon={<Languages size={20} />}
            onClick={handleNodeClick}
          />
        )}
      </div>
      <div className="w-full h-px bg-gray-300/50 dark:bg-gray-600/50 my-1" />
      <div className={`grid ${useDoubleColumn ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
        <WorkflowPaletteItem
          type="markdown"
          label="Markdown"
          icon={<FileType size={20} />}
          onClick={handleNodeClick}
        />
        {config.tts && (
          <WorkflowPaletteItem
            type="audio"
            label="Audio"
            icon={<Volume2 size={20} />}
            onClick={handleNodeClick}
          />
        )}
        {config.image?.enabled && (
          <WorkflowPaletteItem
            type="image"
            label="Image"
            icon={<Image size={20} />}
            onClick={handleNodeClick}
          />
        )}
        <WorkflowPaletteItem
          type="csv"
          label="CSV"
          icon={<Table size={20} />}
          onClick={handleNodeClick}
        />
      </div>
    </div>
  );
}
