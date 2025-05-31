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
    <div className="mt-3 border-t border-neutral-200 dark:border-neutral-700 pt-3">
      <Button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors focus:outline-none"
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
        <Globe className="w-4 h-4" />
        <span>
          References
        </span>
      </Button>
      {!isCollapsed && (
        <div className="mt-3 space-y-2 animate-in fade-in duration-200">
          {urls.map((urlData, index) => (
            <Button
              key={index}
              onClick={() => onURLClick(urlData.url)}
              className="block w-full text-left text-sm p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="truncate font-normal text-neutral-700 dark:text-neutral-300 leading-relaxed" title={urlData.text}>
                    {urlData.text}
                  </div>
                  <div className="truncate text-xs text-neutral-500 dark:text-neutral-400 mt-1" title={urlData.url}>
                    {getDomainFromURL(urlData.url)}
                  </div>
                </div>
                <ExternalLink size={14} className="text-neutral-400 dark:text-neutral-500 flex-shrink-0" />
              </div>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
