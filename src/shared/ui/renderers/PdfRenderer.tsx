import { memo } from 'react';

interface PdfRendererProps {
  src: string;
  name?: string;
}

const NonMemoizedPdfRenderer = ({ src, name }: PdfRendererProps) => {
  return (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>{name || 'PDF Document'}</span>
      </div>

      <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
        <iframe
          src={src}
          className="w-full rounded-b-md"
          style={{
            height: '400px',
            minHeight: '200px',
            border: 'none'
          }}
          title={`Preview of ${name || 'PDF Document'}`}
        />
      </div>
    </div>
  );
};

export const PdfRenderer = memo(
  NonMemoizedPdfRenderer,
  (prevProps, nextProps) =>
    prevProps.src === nextProps.src && prevProps.name === nextProps.name
);
