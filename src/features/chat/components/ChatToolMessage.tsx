import { AlertCircle, ChevronRight } from "lucide-react";
import { memo, useState } from "react";
import { useChat } from "@/features/chat/hooks/useChat";
import { useLastFullscreenApp } from "@/features/chat/hooks/useLastFullscreenApp";
import { getToolDisplayName } from "@/shared/lib/utils";
import type { Content, Message, ToolResultContent } from "@/shared/types/chat";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { getToolCallPreview } from "./chatMessageUtils";
import { InlineMcpApp } from "./InlineMcpApp";

function extractCodeFromArguments(arguments_: string): { code: string; packages?: string[] } | null {
  try {
    const args = JSON.parse(arguments_);
    if (args.code && typeof args.code === "string") {
      return {
        code: args.code,
        packages: args.packages,
      };
    }
    return null;
  } catch {
    return null;
  }
}

type ChatToolMessageProps = {
  message: Message;
  index: number;
};

export const ChatToolMessage = memo(function ChatToolMessage({ message, index }: ChatToolMessageProps) {
  const [toolResultExpanded, setToolResultExpanded] = useState(false);
  const { chat, messages } = useChat();
  const toolResultParts = message.content.filter((p) => p.type === "tool_result") as ToolResultContent[];
  const isLastFullscreenApp = useLastFullscreenApp(messages, index, toolResultParts);

  const toolResult = toolResultParts[0]; // Usually just one
  const isToolError = !!message.error;
  const codeData = toolResult?.arguments ? extractCodeFromArguments(toolResult.arguments) : null;
  const queryPreview =
    !codeData && toolResult?.arguments ? getToolCallPreview(toolResult.name || "", toolResult.arguments) : null;

  // Helper to replace long data URLs with placeholder for display
  const sanitizeForDisplay = (obj: unknown): unknown => {
    if (typeof obj === "string") {
      // Replace data URLs with placeholder
      if (obj.startsWith("data:")) {
        const match = obj.match(/^data:([^;,]+)/);
        const mimeType = match ? match[1] : "unknown";
        return `[${mimeType} data]`;
      }
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitizeForDisplay);
    }
    if (obj && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = sanitizeForDisplay(value);
      }
      return result;
    }
    return obj;
  };

  const renderContent = (content: Content[], name?: string) => {
    // Check if all content is text
    const allText = content.every((c) => c.type === "text");
    if (allText && content.length === 1 && content[0].type === "text") {
      const text = content[0].text;
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(text);
        const sanitized = sanitizeForDisplay(parsed);
        const formatted = JSON.stringify(sanitized, null, 2);
        return <CodeRenderer code={formatted} language="json" name={name} />;
      } catch {
        // Not JSON, render as text
        return <CodeRenderer code={text} language="text" name={name} />;
      }
    } else {
      // Content[] with mixed types - sanitize and stringify for display
      const sanitized = sanitizeForDisplay(content);
      const formatted = JSON.stringify(sanitized, null, 2);
      return <CodeRenderer code={formatted} language="json" name={name} />;
    }
  };

  const getPreviewText = () => {
    if (codeData) return codeData.code.split("\\n")[0];
    if (queryPreview) return queryPreview;
    return null;
  };

  return (
    <div className="pb-2 max-w-full">
      <div className={`${isToolError ? "bg-red-50/30 dark:bg-red-950/5" : ""} rounded-lg overflow-hidden max-w-full`}>
        <button
          onClick={() => setToolResultExpanded(!toolResultExpanded)}
          className="w-full text-left transition-colors"
          type="button"
        >
          <div className="grid grid-cols-[12px_minmax(0,1fr)] items-center gap-1.5 min-w-0">
            <ChevronRight
              className={`w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0 transition-transform ${toolResultExpanded ? "rotate-90" : ""}`}
            />
            <div className="flex items-center gap-2 min-w-0">
              {isToolError && <AlertCircle className="w-3 h-3 text-red-400 dark:text-red-500 shrink-0" />}
              <span
                className={`text-xs font-medium whitespace-nowrap ${isToolError ? "text-red-500 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400"}`}
              >
                {isToolError ? "Tool Error" : `${toolResult?.name ? getToolDisplayName(toolResult.name) : "Tool"}`}
              </span>
              {!toolResultExpanded && getPreviewText() && (
                <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">
                  {getPreviewText()}
                </span>
              )}
            </div>
          </div>
        </button>

        {toolResultExpanded && (
          <div className="ml-4.5 mt-2">
            {codeData ? (
              <CodeRenderer code={codeData.code} language="python" />
            ) : (
              toolResult?.arguments && renderContent([{ type: "text", text: toolResult.arguments }], "Arguments")
            )}
            {(message.error || toolResult?.result) &&
              (message.error ? (
                <CodeRenderer code={message.error.message} language="text" name="Error" />
              ) : (
                renderContent(toolResult?.result || [], "Result")
              ))}
          </div>
        )}

        {/* Always render media content (images, audio, files) from tool results */}
        {toolResult?.result?.some((c) => c.type === "image" || c.type === "audio" || c.type === "file") && (
            <div className="ml-4.5 mt-2">
              <RenderContents contents={toolResult.result} />
            </div>
          )}

        {/* Render inline MCP app for tool results with UI metadata */}
        {typeof toolResult?.meta?.toolProvider === "string" && typeof toolResult?.meta?.toolResource === "string" && (
          <InlineMcpApp
            key={`${chat?.id}-${index}`}
            toolResult={toolResult}
            isLastFullscreenApp={isLastFullscreenApp}
          />
        )}
      </div>
    </div>
  );
});
