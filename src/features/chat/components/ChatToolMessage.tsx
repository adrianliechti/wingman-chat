import { AlertCircle, ChevronRight, Wrench } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useChat } from "@/features/chat/hooks/useChat";
import { useLastFullscreenApp } from "@/features/chat/hooks/useLastFullscreenApp";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { cn } from "@/shared/lib/cn";
import type { Message, ToolResultContent } from "@/shared/types/chat";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { McpProviderIcon } from "@/shared/ui/McpProviderIcon";
import { McpApp } from "./McpApp";
import { findTool, resolveToolHeader, resolveToolInput, resolveToolOutput } from "./toolDisplay";

type ChatToolMessageProps = {
  message: Message;
  index: number;
};

export const ChatToolMessage = memo(function ChatToolMessage({ message, index }: ChatToolMessageProps) {
  const [toolResultExpanded, setToolResultExpanded] = useState(false);
  const { chat, messages } = useChat();
  const { providers } = useToolsContext();
  const toolResultParts = message.content.filter((p) => p.type === "tool_result") as ToolResultContent[];
  const isLastFullscreenApp = useLastFullscreenApp(messages, index, toolResultParts);

  const toolResult = toolResultParts[0]; // Usually just one

  const toolDef = useMemo(() => findTool(providers, toolResult?.name), [providers, toolResult?.name]);
  const toolIcon = toolDef?.icon;
  const isToolError = !!message.error;
  // When a result carries an MCP UI app, the app is the primary renderer; per the
  // MCP Apps spec the `content` blocks are for model context / text-only fallback,
  // so we don't also render the (redundant) media inline.
  //
  // We also require the app's provider to be registered: restoring a chat whose app
  // belongs to an inactive agent (or an MCP filtered out by RBAC) means the client
  // isn't available, so we fall back to the raw result instead of a broken app. Once
  // the provider appears (e.g. the agent is activated) this flips true and McpApp mounts.
  const appProviderId = toolResult?.meta?.toolProvider;
  const hasMcpApp =
    typeof appProviderId === "string" &&
    typeof toolResult?.meta?.toolResource === "string" &&
    providers.some((p) => p.id === appProviderId);
  const header = resolveToolHeader(toolDef, toolResult?.name ?? "", toolResult?.arguments, { error: isToolError });
  const inputBlocks = useMemo(() => resolveToolInput(toolDef, toolResult?.arguments), [toolDef, toolResult?.arguments]);
  const outputBlock = useMemo(
    () => (message.error || !toolResult?.result ? null : resolveToolOutput(toolDef, toolResult.result)),
    [toolDef, message.error, toolResult?.result],
  );

  return (
    <div className="pb-2 max-w-full">
      <div className={cn("rounded-lg overflow-hidden max-w-full", isToolError && "bg-red-50/30 dark:bg-red-950/5")}>
        <button
          onClick={() => setToolResultExpanded(!toolResultExpanded)}
          className="w-full text-left transition-colors"
          type="button"
        >
          <div className="grid grid-cols-[12px_minmax(0,1fr)] items-center gap-1.5 min-w-0">
            <ChevronRight
              className={cn(
                "w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0 transition-transform",
                toolResultExpanded && "rotate-90",
              )}
            />
            <div className="flex items-center gap-2 min-w-0">
              {isToolError ? (
                <AlertCircle className="w-3 h-3 text-red-400 dark:text-red-500 shrink-0" />
              ) : header.Icon ? (
                <header.Icon className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0" />
              ) : toolIcon ? (
                <McpProviderIcon
                  src={toolIcon}
                  size={12}
                  className="shrink-0 w-3 h-3 object-contain text-neutral-400 dark:text-neutral-500"
                />
              ) : (
                <Wrench className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0" />
              )}
              <span
                className={cn(
                  "text-xs whitespace-nowrap truncate",
                  header.mono ? "font-mono" : "font-medium",
                  isToolError ? "text-red-500 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400",
                )}
              >
                {isToolError && !header.Icon ? "Tool Error" : header.label}
              </span>
              {header.preview && (
                <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">
                  {header.preview}
                </span>
              )}
            </div>
          </div>
        </button>

        {toolResultExpanded && (
          <div className="mt-1">
            {/* Input — the tool's blocks, or a best-effort arguments block */}
            {inputBlocks.map((block) => (
              <CodeRenderer
                key={block.name ?? block.language}
                code={block.code}
                language={block.language}
                name={block.name}
                subtle
              />
            ))}
            {/* Output — the error, or the tool's / best-effort result block */}
            {message.error ? (
              <CodeRenderer code={message.error.message} language="text" name="Error" subtle />
            ) : (
              outputBlock && (
                <CodeRenderer code={outputBlock.code} language={outputBlock.language} name={outputBlock.name} subtle />
              )
            )}
          </div>
        )}

        {/* Render media content (images, audio, files) — unless an MCP app owns the display */}
        {!hasMcpApp &&
          toolResult?.result?.some((c) => c.type === "image" || c.type === "audio" || c.type === "file") && (
            <div className="mt-2">
              <RenderContents contents={toolResult.result} />
            </div>
          )}

        {/* Render the MCP UI app (inline or fullscreen) for tool results with UI metadata */}
        {hasMcpApp && (
          <McpApp key={`${chat?.id}-${index}`} toolResult={toolResult} isLastFullscreenApp={isLastFullscreenApp} />
        )}
      </div>
    </div>
  );
});
