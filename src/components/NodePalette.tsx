import { Globe, Sparkles, FileText, FileType, Volume2, Image, StickyNote, Languages, Table, Link, Database } from 'lucide-react';
import { useWorkflow } from '../hooks/useWorkflow';
import type { NodeType, WorkflowNode } from '../types/workflow';

interface NodePaletteItemProps {
  type: NodeType;
  label: string;
  icon: React.ReactNode;
  onClick: (type: NodeType) => void;
}

function NodePaletteItem({ type, label, icon, onClick }: NodePaletteItemProps) {
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

export function NodePalette() {
  const { addNode, nodes } = useWorkflow();

  const handleNodeClick = (type: NodeType) => {
    // Calculate position: start from center-right, offset based on existing node count
    // This ensures new nodes appear in a visible area, not under the toolbar
    const baseX = 200; // Start well right of the toolbar
    const baseY = 100;  // Start from top with some padding
    const offset = nodes.length * 40; // Stagger each new node
    
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type,
      position: { 
        x: baseX + (offset % 400), // Wrap horizontally after 10 nodes
        y: baseY + Math.floor(offset / 400) * 50 // Stack vertically when wrapping
      },
      style: {
        width: 400,
        height: 300
      },
      data: type === 'searchInput' 
        ? { inputText: '', outputText: '', useInput: false }
        : type === 'llm'
        ? { inputText: '', outputText: '', useInput: false, prompt: '' }
        : type === 'translate'
        ? { outputText: '', useInput: false, language: 'en', tone: '', style: '' }
        : type === 'fileInput'
        ? { fileName: '', fileContent: '', outputText: '', useInput: false }
        : type === 'webInput'
        ? { url: '', outputText: '', useInput: false }
        : type === 'textInput'
        ? { content: '', useInput: false }
        : type === 'repositoryInput'
        ? { repositoryId: '', query: '', outputText: '', useInput: false }
        : type === 'markdownOutput'
        ? { inputText: '', outputText: '', error: undefined, useInput: false }
        : type === 'audioOutput'
        ? { audioUrl: undefined, error: undefined, useInput: false }
        : type === 'imageOutput'
        ? { imageUrl: undefined, error: undefined, useInput: false }
        : type === 'csvOutput'
        ? { csvData: undefined, error: undefined, useInput: false }
        : { inputText: '', outputText: '', useInput: false }
    } as WorkflowNode;

    addNode(newNode);
  };

  return (
    <div className="absolute left-4 top-20 z-10 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-xl border border-white/40 dark:border-white/25 shadow-lg p-2 flex flex-col gap-2 max-h-[calc(100vh-6rem)] overflow-y-auto">
      <NodePaletteItem
        type="textInput"
        label="Text Input"
        icon={<StickyNote size={20} />}
        onClick={handleNodeClick}
      />
      <NodePaletteItem
        type="fileInput"
        label="File Input"
        icon={<FileText size={20} />}
        onClick={handleNodeClick}
      />
      <NodePaletteItem
        type="webInput"
        label="Web Input"
        icon={<Link size={20} />}
        onClick={handleNodeClick}
      />
      <NodePaletteItem
        type="searchInput"
        label="Search Input"
        icon={<Globe size={20} />}
        onClick={handleNodeClick}
      />
      <NodePaletteItem
        type="repositoryInput"
        label="Repository Search"
        icon={<Database size={20} />}
        onClick={handleNodeClick}
      />
      <div className="w-full h-px bg-gray-300/50 dark:bg-gray-600/50 my-1" />
      <NodePaletteItem
        type="llm"
        label="Prompt Node"
        icon={<Sparkles size={20} />}
        onClick={handleNodeClick}
      />
      <NodePaletteItem
        type="translate"
        label="Translate"
        icon={<Languages size={20} />}
        onClick={handleNodeClick}
      />
      <div className="w-full h-px bg-gray-300/50 dark:bg-gray-600/50 my-1" />
      <NodePaletteItem
        type="markdownOutput"
        label="Markdown Output"
        icon={<FileType size={20} />}
        onClick={handleNodeClick}
      />
      <NodePaletteItem
        type="audioOutput"
        label="Audio Output"
        icon={<Volume2 size={20} />}
        onClick={handleNodeClick}
      />
      <NodePaletteItem
        type="imageOutput"
        label="Image Output"
        icon={<Image size={20} />}
        onClick={handleNodeClick}
      />
      <NodePaletteItem
        type="csvOutput"
        label="CSV Output"
        icon={<Table size={20} />}
        onClick={handleNodeClick}
      />
    </div>
  );
}
