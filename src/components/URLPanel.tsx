import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@headlessui/react';
import { X, ExternalLink, RefreshCw, AlertTriangle, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { getConfig } from '../config';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';

interface URLPanelProps {
  url: string | null;
  onClose: () => void;
}

export function URLPanel({ url, onClose }: URLPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const transformRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

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

  const handleZoomIn = () => {
    transformRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    transformRef.current?.zoomOut();
  };

  const handleResetZoom = () => {
    transformRef.current?.resetTransform();
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
    <div className={`fixed top-0 right-0 h-full bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-300 dark:border-neutral-700 z-50 flex flex-col transition-all duration-300 ease-out shadow-2xl ${url ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-95'}`}
         style={{ width: '61.8%' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-4 pr-safe-right pt-safe-top bg-neutral-100 dark:bg-neutral-900" style={{ minHeight: 'calc(3.5rem + var(--safe-area-inset-top, 0px))' }}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate" title={url}>
            {new URL(url).hostname}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => window.open(url, '_blank')}
            className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800/50 cursor-pointer focus:outline-none rounded transition-colors"
            title="Open in new tab"
          >
            <ExternalLink size={16} />
          </Button>
          <Button
            onClick={handleRefresh}
            className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800/50 cursor-pointer focus:outline-none rounded transition-colors"
            title="Refresh"
            disabled={isLoading}
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </Button>
          {imageUrl && !isLoading && !hasError && (
            <>
              <div className="w-px h-4 bg-neutral-300 dark:bg-neutral-600" />
              <Button
                onClick={handleZoomIn}
                className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800/50 cursor-pointer focus:outline-none rounded transition-colors"
                title="Zoom In"
              >
                <ZoomIn size={16} />
              </Button>
              <Button
                onClick={handleZoomOut}
                className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800/50 cursor-pointer focus:outline-none rounded transition-colors"
                title="Zoom Out"
              >
                <ZoomOut size={16} />
              </Button>
              <Button
                onClick={handleResetZoom}
                className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800/50 cursor-pointer focus:outline-none rounded transition-colors"
                title="Reset Zoom"
              >
                <RotateCcw size={16} />
              </Button>
            </>
          )}
          <Button
            onClick={onClose}
            className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800/50 cursor-pointer focus:outline-none rounded transition-colors"
            title="Close panel"
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 relative bg-neutral-100 dark:bg-neutral-900">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
              <p className="text-sm text-neutral-500">Extracting content...</p>
            </div>
          </div>
        ) : hasError ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="flex flex-col items-center text-center">
              <AlertTriangle className="w-12 h-12 text-neutral-400 mb-4" />
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Unable to extract content from this URL.
              </p>
            </div>
          </div>
        ) : imageUrl ? (
          <div className="h-full w-full">
            <TransformWrapper ref={transformRef} limitToBounds={false}>
              <TransformComponent>
                <img src={imageUrl} alt="Website Preview" className="w-full h-auto" />
              </TransformComponent>
            </TransformWrapper>
          </div>
        ) : null}
      </div>
    </div>
  );
}
