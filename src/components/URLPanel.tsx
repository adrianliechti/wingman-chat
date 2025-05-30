import { useState } from 'react';
import { Button } from '@headlessui/react';
import { X, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';

interface URLPanelProps {
  url: string | null;
  onClose: () => void;
}

export function URLPanel({ url, onClose }: URLPanelProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  if (!url) return null;

  const handleIframeLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  const handleRefresh = () => {
    setIsLoading(true);
    setHasError(false);
    // Force iframe reload by changing its src
    const iframe = document.querySelector('#url-panel-iframe') as HTMLIFrameElement;
    if (iframe) {
      const currentSrc = iframe.src;
      iframe.src = '';
      setTimeout(() => {
        iframe.src = currentSrc;
      }, 10);
    }
  };

  return (
    <div className={`fixed top-0 right-0 h-full w-full md:w-96 bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-300 dark:border-neutral-700 shadow-2xl z-50 flex flex-col transition-transform duration-300 ${url ? 'translate-x-0' : 'translate-x-full'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate" title={url}>
            {new URL(url).hostname}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => window.open(url, '_blank')}
            className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 cursor-pointer focus:outline-none"
            title="Open in new tab"
          >
            <ExternalLink size={16} />
          </Button>
          <Button
            onClick={handleRefresh}
            className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 cursor-pointer focus:outline-none"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </Button>
          <Button
            onClick={onClose}
            className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 cursor-pointer focus:outline-none"
            title="Close panel"
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
            <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
          </div>
        )}

        {hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
            <AlertTriangle className="w-12 h-12 text-neutral-400 mb-4" />
            <p className="text-neutral-600 dark:text-neutral-400 text-center mb-4">
              Unable to load this URL in the preview panel.
            </p>
            <Button
              onClick={() => window.open(url, '_blank')}
              className="px-4 py-2 bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded hover:bg-neutral-300 dark:hover:bg-neutral-700 transition-colors"
            >
              Open in new tab
            </Button>
          </div>
        )}

        <iframe
          id="url-panel-iframe"
          src={url}
          className="w-full h-full border-0"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  );
}
