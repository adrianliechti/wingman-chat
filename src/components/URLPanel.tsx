import { useState, useEffect, useCallback } from 'react';
import { Button } from '@headlessui/react';
import { X, ExternalLink, RefreshCw, AlertTriangle, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { getConfig } from '../config';

interface URLPanelProps {
  url: string | null;
  onClose: () => void;
}

export function URLPanel({ url, onClose }: URLPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  
  const config = getConfig();

  const handleExtract = useCallback(async () => {
    if (!url) return;

    setIsLoading(true);
    setHasError(false);
    setImageUrl(null);

    try {
      const result = await config.client.extract('image', url);
      
      if (result instanceof Blob) {
        const blobUrl = URL.createObjectURL(result);
        setImageUrl(blobUrl);
      }
    } catch (error) {
      console.error('Extract failed:', error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [url, config.client]);

  const handleRefresh = () => {
    handleExtract();
  };

  useEffect(() => {
    if (url) {
      handleExtract();
    } else {
      setImageUrl(null);
      setHasError(false);
    }
  }, [url, handleExtract]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  if (!url) return null;

  return (
    <div className={`fixed top-0 right-0 h-full w-full md:w-96 bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-300 dark:border-neutral-700 shadow-2xl z-50 flex flex-col transition-transform duration-300 ${url ? 'translate-x-0' : 'translate-x-full'}`}>
      {!isLoading && !hasError && imageUrl ? (
        // Success state: Single TransformWrapper with header and content
        <TransformWrapper
          initialScale={1}
          minScale={0.1}
          maxScale={5}
          limitToBounds={false}
          centerOnInit={true}
          wheel={{ step: 0.1 }}
          pinch={{ step: 5 }}
          doubleClick={{ mode: 'reset' }}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <div className="h-full flex flex-col">
              {/* Header with zoom controls */}
              <div className="flex items-center justify-between p-4 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <h3 className="text-sm font-medium truncate" title={url}>
                    {new URL(url).hostname}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => zoomOut()}
                    className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 cursor-pointer focus:outline-none"
                    title="Zoom out"
                  >
                    <ZoomOut size={16} />
                  </Button>
                  <Button
                    onClick={() => zoomIn()}
                    className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 cursor-pointer focus:outline-none"
                    title="Zoom in"
                  >
                    <ZoomIn size={16} />
                  </Button>
                  <Button
                    onClick={() => resetTransform()}
                    className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 cursor-pointer focus:outline-none"
                    title="Reset zoom (drag to pan)"
                  >
                    <RotateCcw size={16} />
                  </Button>
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
                    disabled={isLoading}
                  >
                    <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
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
              
              {/* Image content */}
              <div className="flex-1 relative">
                <TransformComponent
                  wrapperClass="w-full h-full flex justify-center items-center overflow-hidden bg-neutral-100 dark:bg-neutral-900"
                  contentClass="max-w-none"
                >
                  <img
                    src={imageUrl}
                    alt="Website screenshot"
                    className="max-w-none select-none"
                    draggable={false}
                  />
                </TransformComponent>
              </div>
            </div>
          )}
        </TransformWrapper>
      ) : (
        // Loading/Error states: Simple header and content
        <div className="h-full flex flex-col">
          {/* Header without zoom controls */}
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
                disabled={isLoading}
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
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
          
          {/* Content area */}
          <div className="flex-1 relative">
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
                <div className="flex flex-col items-center gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
                  <p className="text-sm text-neutral-500">Extracting content...</p>
                </div>
              </div>
            ) : hasError ? (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
                <div className="flex flex-col items-center text-center">
                  <AlertTriangle className="w-12 h-12 text-neutral-400 mb-4" />
                  <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                    Unable to extract content from this URL.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
