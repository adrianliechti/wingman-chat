import { useState, useMemo, useRef, useEffect } from "react";
import { Popover } from "@headlessui/react";
import { Button } from "@headlessui/react";
import { Loader2, Edit3Icon, X } from "lucide-react";
import { getConfig } from "../config";

interface RewritePopoverProps {
  selectedText: string;
  fullText: string;
  selectionStart: number;
  selectionEnd: number;
  position: { x: number; y: number };
  onClose: () => void;
  onAlternativeSelect: (alternative: string, contextToReplace: string) => void;
  onPreview?: (previewText: string | null) => void;
}

export function RewritePopover({ 
  selectedText, 
  fullText, 
  selectionStart,
  selectionEnd,
  position, 
  onClose, 
  onAlternativeSelect,
  onPreview
}: RewritePopoverProps) {
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [keyChanges, setKeyChanges] = useState<string[]>([]);
  const [contextToReplace, setContextToReplace] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const config = getConfig();
  const loadedSelectionRef = useRef<string>('');

  // Helper function to create preview text
  const createPreviewText = (alternative: string): string => {
    return fullText.replace(contextToReplace, alternative);
  };

  // Create a unique key for this selection to prevent duplicate calls
  const selectionKey = useMemo(() => 
    `${selectedText}-${selectionStart}-${selectionEnd}-${fullText.length}`, 
    [selectedText, selectionStart, selectionEnd, fullText]
  );

  // Load alternatives when selection changes
  useEffect(() => {
    const loadAlternatives = async () => {
      // Prevent duplicate calls for the same selection
      if (loadedSelectionRef.current === selectionKey || !selectedText.trim() || !fullText.trim()) {
        return;
      }

      loadedSelectionRef.current = selectionKey;
      setIsLoading(true);
      setAlternatives([]);
      setKeyChanges([]);
      setContextToReplace('');

      try {
        const result = await config.client.rewriteSelection(
          config.translator.model || '',
          fullText,
          selectionStart,
          selectionEnd
        );
        
        if (result) {
          setAlternatives(result.alternatives);
          setKeyChanges(result.keyChanges);
          setContextToReplace(result.contextToReplace);
        }
      } catch (error) {
        console.error('Error loading alternatives:', error);
        setAlternatives([]);
        setKeyChanges([]);
        setContextToReplace('');
      } finally {
        setIsLoading(false);
      }
    };

    loadAlternatives();
  }, [selectionKey, fullText, selectionStart, selectionEnd, config.client, config.translator.model, selectedText]);

  // Handle escape key and click outside
  const popoverRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Simple positioning with CSS clamp for safe boundaries
  const menuStyle = useMemo(() => ({
    left: `clamp(10px, ${position.x}px, calc(100vw - 290px))`,
    top: `clamp(10px, ${position.y + 10}px, calc(100vh - 210px))`,
    width: '280px',
  }), [position.x, position.y]);

  return (
    <Popover>
      <Popover.Panel
        ref={popoverRef}
        static
        className="fixed z-50 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-xl overflow-hidden"
        style={menuStyle}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              <Edit3Icon size={14} />
              <span>Rewrite "{selectedText.slice(0, 15)}{selectedText.length > 15 ? '...' : ''}"</span>
            </div>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors p-1 rounded"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="max-h-48 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={16} className="animate-spin text-neutral-500" />
              <span className="ml-2 text-sm text-neutral-500">Loading alternatives...</span>
            </div>
          ) : alternatives.length > 0 ? (
            <div className="py-1">
              {alternatives.map((alternative, index) => {
                const keyChange = keyChanges[index] || alternative;
                return (
                  <Button
                    key={index}
                    onClick={() => {
                      onAlternativeSelect(alternative, contextToReplace);
                      onClose();
                    }}
                    onMouseEnter={() => {
                      if (onPreview) {
                        const previewText = createPreviewText(alternative);
                        onPreview(previewText);
                      }
                    }}
                    onMouseLeave={() => {
                      if (onPreview) {
                        onPreview(null);
                      }
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors border-none"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="font-medium truncate">
                        <span className="text-neutral-400 dark:text-neutral-500">...</span>
                        <span className="mx-1">{keyChange}</span>
                        <span className="text-neutral-400 dark:text-neutral-500">...</span>
                      </div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                        {alternative}
                      </div>
                    </div>
                  </Button>
                );
              })}
            </div>
          ) : !isLoading && alternatives.length === 0 ? (
            <div className="px-3 py-6 text-sm text-neutral-500 text-center">
              No alternatives found for this text.
            </div>
          ) : null}
        </div>
      </Popover.Panel>
    </Popover>
  );
}
