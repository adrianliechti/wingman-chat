import { useState, useEffect, useCallback } from 'react';
import { 
  Folder, 
  FileText, 
  ChevronRight,
  ArrowLeft,
  Loader2, 
  X,
  Check
} from 'lucide-react';
import { RemoteFileSystemAPI } from '../lib/remoteFileSystem';
import type { RemoteFileSource, RemoteFileItem } from '../types/repository';

interface RemoteFilePickerProps {
  onFileSelect?: (files: File[]) => Promise<void>;
  onClose?: () => void;
  selectedSource?: RemoteFileSource | null; // If provided, skip source selection
}

export function RemoteFilePicker({ onFileSelect, onClose, selectedSource: initialSelectedSource }: RemoteFilePickerProps) {
  const [selectedSource] = useState<RemoteFileSource | null>(initialSelectedSource || null);
  const [currentPath, setCurrentPath] = useState('/');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [items, setItems] = useState<RemoteFileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    if (!selectedSource) return;

    try {
      setLoading(true);
      setError(null);
      const response = await RemoteFileSystemAPI.browse(selectedSource.id, currentPath);
      setItems(response.items);
    } catch (err) {
      setError('Failed to load folder contents');
      console.error('Error loading items:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSource, currentPath]);

  // Load items when source or path changes
  useEffect(() => {
    if (selectedSource) {
      loadItems();
    }
  }, [selectedSource, loadItems]);

  const navigateToFolder = (item: RemoteFileItem) => {
    if (item.type !== 'folder') return;

    setPathHistory(prev => [...prev, currentPath]);
    setCurrentPath(item.path);
  };

  const navigateBack = () => {
    if (pathHistory.length > 0) {
      const previousPath = pathHistory[pathHistory.length - 1];
      setPathHistory(prev => prev.slice(0, -1));
      setCurrentPath(previousPath);
    }
  };

    // File selection handlers
  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(fileId)) {
        newSelection.delete(fileId);
      } else {
        newSelection.add(fileId);
      }
      return newSelection;
    });
  };

  const downloadAndSelectFile = async (item: RemoteFileItem) => {
    if (!selectedSource || !onFileSelect) return;
    
    setDownloading(item.id);
    setError(null);
    
    try {
      const file = await RemoteFileSystemAPI.downloadFile(selectedSource.id, item.path);
      await onFileSelect([file]);
    } catch (err) {
      setError(`Failed to download ${item.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDownloading(null);
    }
  };

  const downloadSelectedFiles = async () => {
    if (!selectedSource || !onFileSelect || selectedFiles.size === 0) return;
    
    setDownloading('batch');
    setError(null);
    
    try {
      const files = await Promise.all(
        Array.from(selectedFiles).map(async (fileId) => {
          const item = items.find(i => i.id === fileId);
          if (!item) throw new Error(`File ${fileId} not found`);
          return await RemoteFileSystemAPI.downloadFile(selectedSource.id, item.path);
        })
      );
      await onFileSelect(files);
    } catch (err) {
      setError(`Failed to download files: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDownloading(null);
    }
  };

  const getCurrentFolderName = () => {
    if (currentPath === '/') return selectedSource?.name || 'Root';
    const parts = currentPath.split('/').filter(Boolean);
    return parts[parts.length - 1];
  };

  // If no source is provided, show error
  if (!selectedSource) {
    return (
      <div className="p-4 text-center">
        <div className="text-red-600 dark:text-red-400">
          No source selected
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-96 max-h-[400px]">
      {/* Navigation */}
      <div className="flex items-center px-3 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
        <div className="flex items-center gap-2 flex-1">
          {pathHistory.length > 0 ? (
            <button
              onClick={navigateBack}
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
          ) : (
            <Folder size={20} className="text-neutral-400" />
          )}
          <span className="font-medium text-neutral-500 dark:text-neutral-400">
            {getCurrentFolderName()}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={24} className="animate-spin text-neutral-500" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-600 dark:text-red-400 px-4">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-neutral-500 dark:text-neutral-400 px-4">
            This folder is empty
          </div>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 group"
              >
                {/* Selection area for files - shows icon or checkbox */}
                {item.type === 'file' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFileSelection(item.id);
                    }}
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded transition-colors"
                  >
                    {selectedFiles.has(item.id) ? (
                      <div className="w-4 h-4 border border-neutral-400 bg-neutral-100 dark:border-neutral-500 dark:bg-neutral-700 rounded flex items-center justify-center">
                        <Check className="h-3 w-3 text-neutral-600 dark:text-neutral-300" />
                      </div>
                    ) : (
                      <FileText size={20} className="text-neutral-400" />
                    )}
                  </button>
                )}
                
                {/* File/Folder item */}
                <div
                  className="flex items-center gap-3 flex-1 cursor-pointer"
                  onClick={() => {
                    if (item.type === 'folder') {
                      navigateToFolder(item);
                    } else if (!selectedFiles.has(item.id)) {
                      downloadAndSelectFile(item);
                    }
                  }}
                >
                  {item.type === 'folder' && (
                    <div className="flex-shrink-0">
                      <Folder size={20} className="text-neutral-500 dark:text-neutral-400" />
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100 truncate text-left">
                      {item.name}
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    {downloading === item.id ? (
                      <Loader2 size={16} className="animate-spin text-neutral-500 dark:text-neutral-400" />
                    ) : item.type === 'folder' ? (
                      <ChevronRight size={16} className="text-neutral-400" />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer with select files button */}
      {selectedFiles.size > 0 && (
        <div className="border-t border-neutral-200 dark:border-neutral-700 p-3">
          <button
            onClick={downloadSelectedFiles}
            disabled={downloading === 'batch'}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-neutral-100 hover:bg-neutral-200 disabled:bg-neutral-50 dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:disabled:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-md transition-colors"
          >
            {downloading === 'batch' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            Select {selectedFiles.size} file{selectedFiles.size > 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  );
}
