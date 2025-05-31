import { useState } from 'react';
import { Button } from '@headlessui/react';
import { ExternalLink, Globe, ChevronDown, ChevronRight } from 'lucide-react';
import { DetectedURL } from '../lib/utils';

interface URLListProps {
  urls: DetectedURL[];
  onURLClick: (url: string) => void;
}

export function URLList({ urls, onURLClick }: URLListProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  
  if (urls.length === 0) return null;

  const getDomainFromURL = (url: string) => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-neutral-200/50 dark:border-neutral-700/50">
      <Button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full text-xs text-neutral-400 dark:text-neutral-500 mb-2 flex items-center gap-1 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors cursor-pointer focus:outline-none"
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <Globe size={12} />
        References
      </Button>
      {!isCollapsed && (
        <div className="space-y-1">
          {urls.map((urlData, index) => (
            <div
              key={index}
              onClick={() => onURLClick(urlData.url)}
              className="flex items-center gap-2 p-2 bg-neutral-50/50 dark:bg-neutral-800/30 rounded text-sm hover:bg-neutral-100/80 dark:hover:bg-neutral-700/50 transition-colors cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <div className="truncate font-normal text-neutral-600 dark:text-neutral-300" title={urlData.text}>
                  {urlData.text}
                </div>
                <div className="truncate text-xs text-neutral-400 dark:text-neutral-500" title={urlData.url}>
                  {getDomainFromURL(urlData.url)}
                </div>
              </div>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onURLClick(urlData.url);
                }}
                className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 cursor-pointer focus:outline-none transition-colors flex-shrink-0"
                title="Preview in side panel"
              >
                <ExternalLink size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
