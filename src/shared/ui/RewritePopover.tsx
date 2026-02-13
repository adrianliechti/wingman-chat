import { useState, useEffect, useRef } from "react";
import { Popover } from "@headlessui/react";
import { Loader2 } from "lucide-react";
import { getConfig } from "@/shared/config";

interface RewritePopoverProps {
  selectedText: string;
  fullText: string;
  selectionStart: number;
  selectionEnd: number;
  position: { x: number; y: number };
  onClose: () => void;
  onSelect: (alternative: string, contextToReplace: string) => void;
  onPreview?: (previewText: string | null) => void;
}

interface AlternativeData {
  alternatives: string[];
  keyChanges: string[];
  contextToReplace: string;
}

export function RewritePopover({ 
  selectedText, 
  fullText, 
  selectionStart,
  selectionEnd,
  position, 
  onClose, 
  onSelect,
  onPreview
}: RewritePopoverProps) {
  const [data, setData] = useState<AlternativeData>({
    alternatives: [],
    keyChanges: [],
    contextToReplace: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const config = getConfig();

  // Load alternatives on mount
  useEffect(() => {
    if (hasLoaded || !selectedText.trim() || !fullText.trim()) return;

    const loadAlternatives = async () => {
      setIsLoading(true);
      try {
        const result = await config.client.rewriteSelection(
          config.translator?.model || '',
          fullText,
          selectionStart,
          selectionEnd
        );
        
        if (result) {
          setData({
            alternatives: result.alternatives,
            keyChanges: result.keyChanges,
            contextToReplace: result.contextToReplace
          });
        }
      } catch (error) {
        console.error('Error loading alternatives:', error);
      } finally {
        setIsLoading(false);
        setHasLoaded(true);
      }
    };

    loadAlternatives();
  }, [selectedText, fullText, selectionStart, selectionEnd, config.client, config.translator?.model, hasLoaded]);

  // Handle escape key and click outside
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
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

  const handleAlternativeClick = (alternative: string) => {
    onSelect(alternative, data.contextToReplace);
    onClose();
  };

  const handleMouseEnter = (alternative: string) => {
    if (onPreview) {
      const previewText = fullText.replace(data.contextToReplace, alternative);
      onPreview(previewText);
    }
  };

  const handleMouseLeave = () => {
    if (onPreview) {
      onPreview(null);
    }
  };

  // Calculate optimal width based on content
  const calculateWidth = () => {
    if (data.keyChanges.length === 0) return 200; // fallback for loading/empty states
    
    const maxLength = Math.max(...data.keyChanges.map(change => change.length));
    const baseWidth = Math.max(200, Math.min(400, maxLength * 8 + 80)); // 8px per char + padding
    return baseWidth;
  };

  const popoverWidth = calculateWidth();

  return (
    <Popover>
      <Popover.Panel
        ref={popoverRef}
        static
        className="fixed z-50 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-xl overflow-hidden"
        style={{
          left: `clamp(10px, ${position.x}px, calc(100vw - ${popoverWidth + 20}px))`,
          top: `clamp(10px, ${position.y + 10}px, calc(100vh - 280px))`,
          width: `min(${popoverWidth}px, calc(100vw - 20px))`,
          maxHeight: 'min(270px, calc(100vh - 20px))',
        }}
      >
        {/* Content */}
        <div className="overflow-y-auto" style={{ maxHeight: 'min(270px, calc(100vh - 20px))' }}>
          {isLoading ? (
            <LoadingState />
          ) : data.alternatives.length > 0 ? (
            <AlternativesList
              alternatives={data.alternatives}
              keyChanges={data.keyChanges}
              onSelect={handleAlternativeClick}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </Popover.Panel>
    </Popover>
  );
}

// Sub-components for better organization
function LoadingState() {
  return (
    <div className="flex items-center justify-center py-6">
      <Loader2 size={16} className="animate-spin text-neutral-500" />
      <span className="ml-2 text-sm text-neutral-500">Loading alternatives...</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-3 py-6 text-sm text-neutral-500 text-center">
      No alternatives found for this text.
    </div>
  );
}

interface AlternativesListProps {
  alternatives: string[];
  keyChanges: string[];
  onSelect: (alternative: string) => void;
  onMouseEnter: (alternative: string) => void;
  onMouseLeave: () => void;
}

function AlternativesList({ 
  alternatives, 
  keyChanges, 
  onSelect, 
  onMouseEnter, 
  onMouseLeave 
}: AlternativesListProps) {
  return (
    <div className="py-1">
      {alternatives.map((alternative, index) => {
        const keyChange = keyChanges[index] || alternative;
        return (
          <button
            type="button"
            key={index}
            onClick={() => onSelect(alternative)}
            onMouseEnter={() => onMouseEnter(alternative)}
            onMouseLeave={onMouseLeave}
            className="w-full px-3 py-2 text-left text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors border-none"
          >
            <div className="font-medium leading-relaxed">
              <span className="text-neutral-400 dark:text-neutral-500">...</span>
              <span className="mx-1">{keyChange}</span>
              <span className="text-neutral-400 dark:text-neutral-500">...</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}