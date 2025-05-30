import { Button } from '@headlessui/react';
import { ExternalLink, Globe } from 'lucide-react';
import { DetectedURL } from '../lib/utils';

interface URLListProps {
  urls: DetectedURL[];
  onURLClick: (url: string) => void;
}

export function URLList({ urls, onURLClick }: URLListProps) {
  if (urls.length === 0) return null;

  const getDomainFromURL = (url: string) => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-neutral-300 dark:border-neutral-600">
      <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 flex items-center gap-1">
        <Globe size={12} />
        {urls.length === 1 ? 'Referenced URL:' : `${urls.length} Referenced URLs:`}
      </div>
      <div className="space-y-2">
        {urls.map((urlData, index) => (
          <div
            key={index}
            className="flex items-center gap-2 p-2 bg-neutral-100 dark:bg-neutral-800 rounded text-sm hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium" title={urlData.text}>
                {urlData.text}
              </div>
              <div className="truncate text-xs text-neutral-500 dark:text-neutral-400" title={urlData.url}>
                {getDomainFromURL(urlData.url)}
              </div>
            </div>
            <Button
              onClick={() => onURLClick(urlData.url)}
              className="p-1.5 text-neutral-600 hover:text-blue-600 dark:text-neutral-400 dark:hover:text-blue-400 cursor-pointer focus:outline-none transition-colors flex-shrink-0"
              title="Preview in side panel"
            >
              <ExternalLink size={14} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
