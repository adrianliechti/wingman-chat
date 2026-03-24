import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Markdown } from '@/shared/ui/Markdown';

interface SlideViewerProps {
  content: string;
  slides: string[];
}

export function SlideViewer({ content, slides }: SlideViewerProps) {
  // Index 0 = text view, 1+ = slide images
  const [activeIndex, setActiveIndex] = useState(slides.length > 0 ? 1 : 0);

  return (
    <div className="h-full flex flex-col">
      {/* Main view */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeIndex === 0 ? (
          <div className="p-6">
            <div className="prose prose-neutral dark:prose-invert max-w-none">
              <Markdown>{content}</Markdown>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center p-6">
            <img
              src={slides[activeIndex - 1]}
              alt={`Slide ${activeIndex}`}
              className="max-w-full max-h-full rounded-lg shadow-lg"
            />
          </div>
        )}
      </div>

      {/* Bottom thumbnail navigation */}
      <div className="shrink-0 overflow-x-auto px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Text view thumbnail */}
          <button
            type="button"
            onClick={() => setActiveIndex(0)}
            className={`shrink-0 w-20 aspect-[16/10] rounded-lg border-2 flex items-center justify-center transition-colors ${
              activeIndex === 0
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 bg-neutral-50 dark:bg-neutral-800/50'
            }`}
          >
            <FileText
              size={14}
              className={activeIndex === 0 ? 'text-blue-500' : 'text-neutral-400'}
            />
          </button>

          {/* Slide thumbnails */}
          {slides.map((slideUrl, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIndex(i + 1)}
              className={`shrink-0 w-20 aspect-[16/10] rounded-lg border-2 overflow-hidden transition-colors ${
                activeIndex === i + 1
                  ? 'border-blue-500'
                  : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'
              }`}
            >
              <img
                src={slideUrl}
                alt={`Slide ${i + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
