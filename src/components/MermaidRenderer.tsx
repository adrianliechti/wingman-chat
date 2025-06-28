import { memo, useEffect, useRef, useState } from 'react';
import { Eye, Code } from 'lucide-react';
import { Button } from '@headlessui/react';
import { useTheme } from '../contexts/ThemeContext';
import { CopyButton } from './CopyButton';

interface MermaidRendererProps {
  chart: string;
  language: string;
}

interface MermaidAPI {
  initialize: (config: any) => void;
  render: (id: string, definition: string) => Promise<{ svg: string }>;
}

const NonMemoizedMermaidRenderer = ({ chart, language }: MermaidRendererProps) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [mermaidLoaded, setMermaidLoaded] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [currentChart, setCurrentChart] = useState<string>(chart);
  const [editValue, setEditValue] = useState<string>(chart);
  const elementId = useRef(`mermaid-${Math.random().toString(36).substr(2, 9)}`);
  const mermaidRef = useRef<MermaidAPI | null>(null);
  const { isDark } = useTheme();

  // Basic Mermaid validation check
  const isValidMermaid = (chartString: string): boolean => {
    const trimmed = chartString.trim();
    return trimmed.length > 0 && (
      trimmed.includes('graph') ||
      trimmed.includes('flowchart') ||
      trimmed.includes('sequenceDiagram') ||
      trimmed.includes('classDiagram') ||
      trimmed.includes('stateDiagram') ||
      trimmed.includes('erDiagram') ||
      trimmed.includes('journey') ||
      trimmed.includes('gantt') ||
      trimmed.includes('pie') ||
      trimmed.includes('gitGraph') ||
      trimmed.includes('mindmap') ||
      trimmed.includes('timeline') ||
      trimmed.includes('sankey') ||
      trimmed.includes('requirement') ||
      trimmed.includes('C4') ||
      trimmed.includes('quadrant')
    );
  };

  const hasValidMermaid = isValidMermaid(currentChart);

  // Keep editValue and currentChart in sync with chart when chart prop changes (e.g., new diagram)
  useEffect(() => {
    setEditValue(chart);
    setCurrentChart(chart);
  }, [chart]);

  // Dynamically import and configure mermaid
  useEffect(() => {
    const loadMermaid = async () => {
      if (!mermaidRef.current) {
        try {
          const mermaidModule = await import('mermaid');
          mermaidRef.current = mermaidModule.default;
          setMermaidLoaded(true);
        } catch (error) {
          console.error('Failed to load Mermaid:', error);
          setError('Failed to load diagram renderer');
          setIsLoading(false);
        }
      }
    };

    loadMermaid();
  }, []);

  // Configure mermaid theme when loaded or theme changes
  useEffect(() => {
    if (!mermaidRef.current || !mermaidLoaded) return;

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
  }, [isDark, mermaidLoaded]);

  useEffect(() => {
    const renderMermaid = async () => {
      if (!mermaidRef.current || !mermaidLoaded) return;

      if (!currentChart.trim()) {
        setIsLoading(true);
        setError('');
        setSvg('');
        return;
      }

      try {
        setIsLoading(true);
        setError('');

        // Basic validation - check if it looks like mermaid syntax
        const trimmedChart = currentChart.trim();
        if (!trimmedChart || trimmedChart.length < 3) {
          setIsLoading(false);
          return;
        }

        // Generate a new element ID to force re-render when theme changes
        elementId.current = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

        // Validate and render the chart
        const { svg: renderedSvg } = await mermaidRef.current.render(elementId.current, currentChart);
        setSvg(renderedSvg);
        setIsLoading(false);
      } catch {
        // Silently handle errors - just show the code block
        setError('silent');
        setSvg('');
        setIsLoading(false);
      }
    };

    // Debounce rendering to avoid excessive re-renders during streaming
    const timeoutId = setTimeout(renderMermaid, 300);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [currentChart, isDark, mermaidLoaded]);

  // Show loading placeholder while mermaid is loading
  if (!mermaidLoaded) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-700 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{language}</span>
        </div>
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-b-md border border-gray-200 dark:border-neutral-700">
          <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span className="ml-2">Loading diagram renderer...</span>
          </div>
        </div>
      </div>
    );
  }

  // Show loading placeholder while streaming or processing
  if (isLoading && !chart.trim()) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-700 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{language}</span>
        </div>
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-b-md border border-gray-200 dark:border-neutral-700">
          <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
            <div className="animate-pulse">Waiting for diagram...</div>
          </div>
        </div>
      </div>
    );
  }

  // Show error fallback with raw code (subtle error display)
  if (error) {
    // When render fails, show editable textarea to fix the source code
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-700 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{language}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-500 dark:text-red-400 opacity-70">render failed</span>
            <CopyButton text={editValue} />
          </div>
        </div>
        <div className="bg-white dark:bg-neutral-800 rounded-b-md p-4 border border-gray-200 dark:border-neutral-700">
          <textarea
            className="w-full min-h-[120px] max-h-[400px] text-gray-800 dark:text-neutral-300 text-sm font-mono bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded p-2 resize-vertical focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          <div className="flex justify-end mt-2 gap-2">
            <Button
              onClick={() => {
                setShowPreview(true);
                if (editValue !== currentChart) {
                  setCurrentChart(editValue);
                  window.dispatchEvent(new CustomEvent('mermaid-edit', { detail: { newChart: editValue } }));
                  setError('');
                }
              }}
              className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              title="Apply changes and preview"
            >
              Save & Preview
            </Button>
            <Button
              onClick={() => {
                setEditValue(currentChart);
                setShowPreview(true);
                setError('');
              }}
              className="px-3 py-1 bg-neutral-400 text-white rounded hover:bg-neutral-500 transition-colors"
              title="Cancel editing"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Show loading spinner while processing
  if (isLoading && chart.trim()) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-700 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{language}</span>
        </div>
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-b-md border border-gray-200 dark:border-neutral-700">
          <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span className="ml-2">Rendering diagram...</span>
          </div>
        </div>
      </div>
    );
  }

  // Render the mermaid diagram
  if (svg) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-700 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{language}</span>
          <div className="flex items-center gap-2">
            {hasValidMermaid && (
              <Button
                onClick={() => setShowPreview(!showPreview)}
                className="text-neutral-300 hover:text-white transition-colors"
                title={showPreview ? 'Show code' : 'Show preview'}
              >
                {showPreview ? (
                  <Code className="h-4" />
                ) : (
                  <Eye className="h-4" />
                )}
              </Button>
            )}
            <CopyButton text={showPreview ? currentChart : editValue} />
          </div>
        </div>
        <div className="bg-white dark:bg-neutral-800 rounded-b-md">
          {hasValidMermaid && showPreview ? (
            <div className="p-4 overflow-x-auto">
              <div
                className="mermaid-diagram flex justify-center"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          ) : (
            <div className="p-4">
              <textarea
                className="w-full min-h-[120px] max-h-[400px] text-gray-800 dark:text-neutral-300 text-sm font-mono bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded p-2 resize-vertical focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              <div className="flex justify-end mt-2 gap-2">
                <Button
                  onClick={() => {
                    setShowPreview(true);
                    if (editValue !== currentChart) {
                      setCurrentChart(editValue);
                      window.dispatchEvent(new CustomEvent('mermaid-edit', { detail: { newChart: editValue } }));
                    }
                  }}
                  className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  title="Apply changes and preview"
                >
                  Save & Preview
                </Button>
                <Button
                  onClick={() => {
                    setEditValue(currentChart);
                    setShowPreview(true);
                  }}
                  className="px-3 py-1 bg-neutral-400 text-white rounded hover:bg-neutral-500 transition-colors"
                  title="Cancel editing"
                >
                  Cancel
                </Button>
              </div>
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
    prevProps.chart === nextProps.chart && prevProps.language === nextProps.language
);
