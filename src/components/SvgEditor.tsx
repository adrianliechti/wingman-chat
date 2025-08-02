import { useState, useEffect } from 'react';
import { Code, Eye } from 'lucide-react';
import { Button } from '@headlessui/react';
import { CodeEditor } from './CodeEditor';

// Component to display SVG content
function SvgPreview({ blob }: { blob: Blob }) {
  const [svgContent, setSvgContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSvg = async () => {
      try {
        let text = await blob.text();
        
        // Make SVG responsive by removing fixed dimensions and adding responsive styles
        text = text.replace(/<svg([^>]*)>/i, (_, attributes) => {
          // Remove width and height attributes but keep viewBox
          const newAttributes = attributes
            .replace(/\s*width\s*=\s*"[^"]*"/gi, '')
            .replace(/\s*height\s*=\s*"[^"]*"/gi, '');
          
          // Add responsive styling
          return `<svg${newAttributes} style="width: 100%; height: 100%; max-width: 100%; max-height: 100%;">`;
        });
        
        setSvgContent(text);
      } catch {
        setSvgContent('<svg style="width: 100%; height: 100%;"><text x="10" y="20" fill="red">Error loading SVG content</text></svg>');
      } finally {
        setLoading(false);
      }
    };

    loadSvg();
  }, [blob]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-neutral-500">Loading preview...</div>
      </div>
    );
  }

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
  blob: Blob;
}

export function SvgEditor({ blob }: SvgEditorProps) {
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('preview');

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Subtle View Mode Toggle - Top Right */}
      <div className="absolute top-2 right-2 z-10">
        <Button
          onClick={() => setViewMode(viewMode === 'code' ? 'preview' : 'code')}
          className="p-1.5 rounded-md transition-colors bg-white/80 dark:bg-neutral-700/80 backdrop-blur-sm border border-neutral-200/50 dark:border-neutral-500/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/80 dark:hover:bg-neutral-600/80"
          title={viewMode === 'code' ? 'Switch to preview' : 'Switch to code'}
        >
          {viewMode === 'code' ? <Eye size={16} /> : <Code size={16} />}
        </Button>
      </div>
      
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'preview' ? (
          <SvgPreview blob={blob} />
        ) : (
          <CodeEditor blob={blob} language="svg" />
        )}
      </div>
    </div>
  );
}
