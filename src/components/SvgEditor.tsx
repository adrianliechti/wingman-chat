import { CodeEditor } from './CodeEditor';

// Component to display SVG content
function SvgPreview({ content }: { content: string }) {
  // Make SVG responsive by removing fixed dimensions and adding responsive styles
  const svgContent = content.replace(/<svg([^>]*)>/i, (_, attributes) => {
    // Remove width and height attributes but keep viewBox
    const newAttributes = attributes
      .replace(/\s*width\s*=\s*"[^"]*"/gi, '')
      .replace(/\s*height\s*=\s*"[^"]*"/gi, '');
    
    // Add responsive styling
    return `<svg${newAttributes} style="width: 100%; height: 100%; max-width: 100%; max-height: 100%;">`;
  });

  return (
    <div className="h-full p-4">
      <div 
        className="w-full h-full"
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
}

interface SvgEditorProps {
  content: string;
  viewMode?: 'code' | 'preview';
  onViewModeChange?: (mode: 'code' | 'preview') => void;
}

export function SvgEditor({ content, viewMode = 'preview' }: SvgEditorProps) {
  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-auto min-h-0">
        {viewMode === 'preview' ? (
          <SvgPreview content={content} />
        ) : (
          <CodeEditor content={content} language="xml" />
        )}
      </div>
    </div>
  );
}
