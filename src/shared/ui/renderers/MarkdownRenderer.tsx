import { memo, useState } from "react";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Markdown } from "@/shared/ui/Markdown";
import { PreviewButton } from "@/shared/ui/PreviewButton";
import { RendererFrame } from "./RendererFrame";

interface MarkdownRendererProps {
  content: string;
  language: string;
}

const NonMemoizedMarkdownRenderer = ({ content, language }: MarkdownRendererProps) => {
  const [showCode, setShowCode] = useState(false);
  const isEmpty = !content.trim();

  return (
    <RendererFrame
      label={language}
      actions={
        <>
          <PreviewButton showCode={showCode} onToggle={() => setShowCode(!showCode)} label />
          <CopyButton text={content} label="Copy" />
        </>
      }
    >
      {showCode ? (
        <div className="p-4">
          <pre className="text-neutral-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
            <code>{content}</code>
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
        <div className="p-4">
          <Markdown>{content}</Markdown>
        </div>
      )}
    </RendererFrame>
  );
};

export const MarkdownRenderer = memo(
  NonMemoizedMarkdownRenderer,
  (prevProps, nextProps) => prevProps.content === nextProps.content && prevProps.language === nextProps.language,
);
