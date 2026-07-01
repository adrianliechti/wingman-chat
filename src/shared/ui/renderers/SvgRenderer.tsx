import { memo, useMemo, useState } from "react";
import { CopyButton } from "@/shared/ui/CopyButton";
import { PreviewButton } from "@/shared/ui/PreviewButton";
import { RendererFrame } from "./RendererFrame";

interface SvgRendererProps {
  svg: string;
  language: string;
  name?: string;
}

const extractTitle = (svg: string): string | null => {
  const match = svg.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1].trim() ? match[1].trim() : null;
};

const NonMemoizedSvgRenderer = ({ svg, language, name }: SvgRendererProps) => {
  const [showCode, setShowCode] = useState(false);
  const isComplete = svg.trim().length > 0 && /<\/svg>/i.test(svg);
  const title = extractTitle(svg) || name;
  const svgPreviewUrl = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg]);

  return (
    <RendererFrame
      label={language}
      name={title}
      actions={
        <>
          <PreviewButton showCode={showCode} onToggle={() => setShowCode(!showCode)} label />
          <CopyButton text={svg} label="Copy" />
        </>
      }
    >
      {showCode ? (
        <div className="p-4">
          <pre className="text-neutral-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
            <code>{svg}</code>
          </pre>
        </div>
      ) : isComplete ? (
        <div className="flex items-center justify-center p-4 overflow-auto max-h-[75vw]">
          <img src={svgPreviewUrl} alt={title || language} className="max-w-full object-contain" />
        </div>
      ) : (
        <div className="flex items-center justify-center h-24 text-neutral-500">
          <div className="flex items-center space-x-3">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-neutral-300 border-t-neutral-600 dark:border-neutral-600 dark:border-t-neutral-400" />
            <span>Generating SVG...</span>
          </div>
        </div>
      )}
    </RendererFrame>
  );
};

export const SvgRenderer = memo(
  NonMemoizedSvgRenderer,
  (prevProps, nextProps) =>
    prevProps.svg === nextProps.svg && prevProps.language === nextProps.language && prevProps.name === nextProps.name,
);
