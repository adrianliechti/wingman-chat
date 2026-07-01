import { memo, useState } from "react";
import { CopyButton } from "@/shared/ui/CopyButton";
import { HtmlPreview } from "@/shared/ui/HtmlPreview";
import { PreviewButton } from "@/shared/ui/PreviewButton";
import { RendererFrame } from "./RendererFrame";

interface HtmlRendererProps {
  html: string;
  language: string;
  name?: string;
}

// Utility function to extract title from HTML content
const extractTitle = (html: string): string | null => {
  // Extract from <title> tag only
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch?.[1].trim()) {
    return titleMatch[1].trim();
  }

  return null;
};

const NonMemoizedHtmlRenderer = ({ html, language, name }: HtmlRendererProps) => {
  const [showCode, setShowCode] = useState(false);

  const title = extractTitle(html) || name;
  const isEmpty = !html.trim();

  return (
    <RendererFrame
      label={language}
      name={title}
      actions={
        <>
          <PreviewButton showCode={showCode} onToggle={() => setShowCode(!showCode)} label />
          <CopyButton text={html} label="Copy" />
        </>
      }
    >
      {showCode ? (
        <div className="p-4">
          <pre className="text-neutral-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
            <code>{html}</code>
          </pre>
        </div>
      ) : isEmpty ? (
        <div className="flex items-center justify-center h-24 text-neutral-500">
          <div className="flex items-center space-x-3">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-neutral-300 border-t-neutral-600 dark:border-neutral-600 dark:border-t-neutral-400" />
            <span>Generating Content...</span>
          </div>
        </div>
      ) : (
        <HtmlPreview
          content={html}
          title={title || language}
          className="w-full"
          style={{ height: "400px" }}
          reloadDebounceMs={250}
        />
      )}
    </RendererFrame>
  );
};

export const HtmlRenderer = memo(
  NonMemoizedHtmlRenderer,
  (prevProps, nextProps) =>
    prevProps.html === nextProps.html && prevProps.language === nextProps.language && prevProps.name === nextProps.name,
);
