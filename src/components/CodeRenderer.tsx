import { memo, useState, useEffect } from 'react';
import { codeToHtml } from 'shiki';
import { ExternalLink } from 'lucide-react';
import { CopyButton } from './CopyButton';
import { useTheme } from '../hooks/useTheme';
import { useArtifacts } from '../hooks/useArtifacts';

interface CodeRendererProps {
  code: string;
  language: string;
  name?: string;
}

const CodeRenderer = memo(({ code, language, name }: CodeRendererProps) => {
  const { isDark } = useTheme();
  const { isAvailable: isArtifactsAvailable, openFile, fs, setShowArtifactsDrawer } = useArtifacts();
  const [html, setHtml] = useState<string>('');

  const handleOpenInArtifacts = () => {
    if (!name || !isArtifactsAvailable) return;
    
    // Ensure the path starts with /
    const filePath = name.startsWith('/') ? name : `/${name}`;
    
    // Create or update the file in the artifacts filesystem
    fs.createFile(filePath, code);
    
    // Open the file in the artifacts drawer
    openFile(filePath);
    
    // Make sure the artifacts drawer is visible
    setShowArtifactsDrawer(true);
  };

  useEffect(() => {
    if (!code) {
      setHtml('');
      return;
    }

    let isCancelled = false;

    const highlightCode = async () => {
      try {
        const langId = language.toLowerCase();
        
        if (isCancelled) return;

        const html = await codeToHtml(code, {
          lang: langId,
          theme: isDark ? 'one-dark-pro' : 'one-light',
          colorReplacements: {
            '#fafafa': 'transparent', // one-light background
            '#282c34': 'transparent', // one-dark-pro background
          }
        });
        
        if (!isCancelled) {
          setHtml(html);
        }
      } catch (error) {
        console.error('Failed to highlight code:', error);
        if (!isCancelled) {
          setHtml('');
        }
      }
    };

    highlightCode();

    return () => {
      isCancelled = true;
    };
  }, [code, language, isDark]);

  const renderCodeBlock = (content: React.ReactNode) => (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>
          {language}
          {name && <span className="ml-2 text-gray-500 dark:text-neutral-400">• {name}</span>}
        </span>
        <div className="flex items-center space-x-2">
          {name && isArtifactsAvailable && (
            <button
              onClick={handleOpenInArtifacts}
              className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-60 hover:opacity-100 p-1"
              title="Open in Artifacts"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
          <CopyButton text={code} className="h-4 w-4" />
        </div>
      </div>
      <div className="bg-white dark:bg-neutral-900 rounded-b-md overflow-hidden border-l border-r border-b border-gray-100 dark:border-neutral-800">
        {content}
      </div>
    </div>
  );

  if (!html) {
    return renderCodeBlock(
      <pre className="p-4 text-gray-800 dark:text-neutral-300 text-sm whitespace-pre overflow-x-auto">
        <code>{code}</code>
      </pre>
    );
  }

  return renderCodeBlock(
    <div 
      className="overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        margin: 0,
        padding: '1rem',
        fontSize: '0.875rem',
        lineHeight: '1.25rem',
        fontFamily: 'Fira Code, Monaco, Cascadia Code, Roboto Mono, monospace',
        background: 'transparent'
      }}
    />
  );
});

CodeRenderer.displayName = 'CodeRenderer';

export { CodeRenderer };