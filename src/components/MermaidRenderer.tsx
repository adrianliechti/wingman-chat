import { memo, useEffect, useRef, useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import { CopyButton } from './CopyButton';
import { PreviewButton } from './PreviewButton';

interface MermaidRendererProps {
  chart: string;
  language: string;
  name?: string;
}

interface MermaidAPI {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, definition: string) => Promise<{ svg: string }>;
}

// Utility function to extract title from Mermaid content
const extractTitle = (chart: string): string | null => {
  // Extract title field from Mermaid diagram
  const titleMatch = chart.match(/title\s*[:]?\s*(.+)/i);
  if (titleMatch && titleMatch[1].trim()) {
    return titleMatch[1].trim().replace(/["']/g, ''); // Remove quotes if present
  }
  
  return null;
};

const NonMemoizedMermaidRenderer = ({ chart, language, name }: MermaidRendererProps) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isComplete, setIsComplete] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const elementId = useRef(`mermaid-${Math.random().toString(36).substr(2, 9)}`);
  const mermaidRef = useRef<MermaidAPI | null>(null);
  const { isDark } = useTheme();

  const extractedTitle = extractTitle(chart);

  // Dynamically import and configure mermaid
  useEffect(() => {
    const loadMermaid = async () => {
      if (!mermaidRef.current) {
        try {
          const mermaidModule = await import('mermaid');
          mermaidRef.current = mermaidModule.default;
          setIsComplete(true);
        } catch (error) {
          console.error('Failed to load Mermaid:', error);
          setError('Failed to load diagram renderer');
        }
      }
    };

    loadMermaid();
  }, []);

  // Configure mermaid theme when loaded or theme changes
  useEffect(() => {
    if (!mermaidRef.current || !isComplete) return;

    const themeConfig = {
      startOnLoad: false,
      securityLevel: 'loose' as const,
      suppressErrorRendering: true,
      theme: 'base' as const,
      themeVariables: isDark ? {
        // Dark mode configuration
        primaryColor: '#64748b',        // Slate-500
        primaryBorderColor: '#475569',  // Slate-600
        lineColor: '#94a3b8',          // Slate-400
        secondaryColor: '#1e293b',     // Slate-800
        tertiaryColor: '#334155',      // Slate-700
        background: '#1f2937',         // Gray-800 (dark background)
        mainBkg: '#1f2937',           // Gray-800
        secondBkg: '#374151',         // Gray-700
        tertiaryBkg: '#4b5563',       // Gray-600
        // Pie chart specific colors - slate palette for dark mode
        pie1: '#f8fafc',              // Slate-50 (brightest)
        pie2: '#f1f5f9',              // Slate-100 (very bright)
        pie3: '#e2e8f0',              // Slate-200 (bright)
        pie4: '#cbd5e1',              // Slate-300 (bright)
        pie5: '#94a3b8',              // Slate-400 (medium bright)
        pie6: '#64748b',              // Slate-500 (medium)
        pie7: '#475569',              // Slate-600 (medium dark)
        pie8: '#334155',              // Slate-700 (dark)
        pie9: '#1e293b',              // Slate-800 (darker)
        pie10: '#0f172a',             // Slate-900 (darkest)
        pie11: '#f3f4f6',             // Gray-100 (light variant)
        pie12: '#9ca3af',             // Gray-400 (medium variant)
        // Text colors - white/light for dark mode
        pieTitleTextSize: '24px',
        pieTitleTextColor: '#ffffff',  // White
        pieSectionTextSize: '16px',
        pieSectionTextColor: '#ffffff', // White
        pieLegendTextSize: '14px',
        pieLegendTextColor: '#e5e7eb', // Gray-200 (light)
        // Node colors - white/light for dark mode
        primaryTextColor: '#ffffff',   // White
        secondaryTextColor: '#e5e7eb', // Gray-200 (light)
        tertiaryTextColor: '#d1d5db',  // Gray-300 (light)
      } : {
        // Light mode configuration
        primaryColor: '#64748b',        // Slate-500
        primaryBorderColor: '#475569',  // Slate-600
        lineColor: '#94a3b8',          // Slate-400
        secondaryColor: '#1e293b',     // Slate-800
        tertiaryColor: '#334155',      // Slate-700
        background: '#ffffff',         // White background (matching main container)
        mainBkg: '#ffffff',           // White
        secondBkg: '#f8fafc',         // Slate-50
        tertiaryBkg: '#f1f5f9',       // Slate-100
        // Pie chart specific colors - slate palette for light mode
        pie1: '#0f172a',              // Slate-900 (darkest)
        pie2: '#1e293b',              // Slate-800 (darker)
        pie3: '#334155',              // Slate-700 (dark)
        pie4: '#475569',              // Slate-600 (medium dark)
        pie5: '#64748b',              // Slate-500 (medium)
        pie6: '#94a3b8',              // Slate-400 (medium bright)
        pie7: '#cbd5e1',              // Slate-300 (bright)
        pie8: '#e2e8f0',              // Slate-200 (very bright)
        pie9: '#f1f5f9',              // Slate-100 (brightest)
        pie10: '#f8fafc',             // Slate-50 (very bright)
        pie11: '#374151',             // Gray-700 (dark variant)
        pie12: '#6b7280',             // Gray-500 (medium variant)
        // Text colors - darker for better contrast
        pieTitleTextSize: '24px',
        pieTitleTextColor: '#0f172a',  // Slate-900 (very dark)
        pieSectionTextSize: '16px',
        pieSectionTextColor: '#0f172a', // Slate-900 (very dark)
        pieLegendTextSize: '14px',
        pieLegendTextColor: '#1f2937', // Gray-800 (darker)
        // Node colors - darker for better contrast
        primaryTextColor: '#0f172a',   // Slate-900 (very dark)
        secondaryTextColor: '#1f2937', // Gray-800 (darker)
        tertiaryTextColor: '#374151',  // Gray-700 (darker)
      }
    };

    mermaidRef.current.initialize(themeConfig);
  }, [isDark, isComplete]);

  useEffect(() => {
    const renderMermaid = async () => {
      if (!mermaidRef.current || !isComplete) return;
      
      if (!chart.trim()) {
        setError('');
        setSvg('');
        return;
      }

      try {
        setError('');
        
        // Basic validation - check if it looks like mermaid syntax
        const trimmedChart = chart.trim();
        if (!trimmedChart || trimmedChart.length < 3) {
          return;
        }
        
        // Generate a new element ID to force re-render when theme changes
        elementId.current = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        
        // Validate and render the chart
        const { svg: renderedSvg } = await mermaidRef.current.render(elementId.current, chart);
        setSvg(renderedSvg);
      } catch {
        // Silently handle errors - just show the code block
        setError('silent');
        setSvg('');
      }
    };

    // Debounce rendering to avoid excessive re-renders during streaming
    const timeoutId = setTimeout(renderMermaid, 300);
    
    return () => {
      clearTimeout(timeoutId);
    };
  }, [chart, isDark, isComplete]);

  // Show loading placeholder while mermaid is loading
  if (!isComplete) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{extractedTitle || name || language}</span>
          <div className="flex items-center gap-2">
            <PreviewButton 
              showCode={showCode} 
              onToggle={() => setShowCode(!showCode)} 
              className="h-4 w-4" 
            />
            <CopyButton text={chart} className="h-4 w-4" />
          </div>
        </div>
        <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
          {showCode ? (
            <div className="p-4">
              <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
                <code>{chart}</code>
              </pre>
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-600 dark:border-neutral-400"></div>
              <span className="ml-2">Loading diagram renderer...</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show generating content placeholder when we have chart content but no SVG yet (and not in error state)
  if (chart.trim() && !svg && !error) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{extractedTitle || name || language}</span>
          <div className="flex items-center gap-2">
            <PreviewButton 
              showCode={showCode} 
              onToggle={() => setShowCode(!showCode)} 
              className="h-4 w-4" 
            />
            <CopyButton text={chart} className="h-4 w-4" />
          </div>
        </div>
        <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
          {showCode ? (
            <div className="p-4">
              <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
                <code>{chart}</code>
              </pre>
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600 dark:border-neutral-600 dark:border-t-neutral-400"></div>
                <span>Generating Content...</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show loading placeholder while streaming or processing
  if (!chart.trim()) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{extractedTitle || name || language}</span>
          <div className="flex items-center gap-2">
            <PreviewButton 
              showCode={showCode} 
              onToggle={() => setShowCode(!showCode)} 
              className="h-4 w-4" 
            />
            <CopyButton text={chart} className="h-4 w-4" />
          </div>
        </div>
        <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
          <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
            <div className="animate-pulse">Waiting for diagram...</div>
          </div>
        </div>
      </div>
    );
  }

  // Show error fallback with raw code (subtle error display)
  if (error) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{extractedTitle || name || language}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-500 dark:text-red-400 opacity-70">render failed</span>
            <CopyButton text={chart} className="h-4 w-4" />
          </div>
        </div>
        <div className="bg-white dark:bg-neutral-900 p-4 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
          <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
            <code>{chart}</code>
          </pre>
        </div>
      </div>
    );
  }

  // Render the mermaid diagram
  if (svg) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{extractedTitle || name || language}</span>
          <div className="flex items-center gap-2">
            <PreviewButton 
              showCode={showCode} 
              onToggle={() => setShowCode(!showCode)} 
              className="h-4 w-4" 
            />
            <CopyButton text={chart} className="h-4 w-4" />
          </div>
        </div>
        <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
          {showCode ? (
            <div className="p-4">
              <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
                <code>{chart}</code>
              </pre>
            </div>
          ) : (
            <div className="p-4 overflow-x-auto">
              <div 
                className="mermaid-diagram flex justify-center"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export const MermaidRenderer = memo(
  NonMemoizedMermaidRenderer,
  (prevProps, nextProps) => 
    prevProps.chart === nextProps.chart && 
    prevProps.language === nextProps.language &&
    prevProps.name === nextProps.name
);
