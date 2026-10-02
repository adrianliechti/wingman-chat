import { memo, useMemo, useState } from "react";
import { useChatConversation } from "@/features/chat/hooks/useChat";
import { useLastFullscreenApp } from "@/features/chat/hooks/useLastFullscreenApp";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import type { Message, ToolResultContent } from "@/shared/types/chat";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { Markdown } from "@/shared/ui/Markdown";
import { ActivityRow } from "./ActivityRow";
import { McpApp } from "./McpApp";
import { findTool, resolveToolHeader, resolveToolInput, resolveToolOutput } from "./toolDisplay";

type ChatToolMessageProps = {
  message: Message;
  index: number;
  messages?: Message[];
  /** Inside a group or subagent: no icon, the parent row already names the activity. */
  nested?: boolean;
};

export const ChatToolMessage = memo(function ChatToolMessage({
  message,
  index,
  messages: scope,
  nested,
}: ChatToolMessageProps) {
  const [toolResultExpanded, setToolResultExpanded] = useState(false);
  const { chat, messages: chatMessages } = useChatConversation();
  const messages = scope ?? chatMessages;
  const { providers } = useToolsContext();
  const toolResultParts = message.content.filter((p) => p.type === "tool_result") as ToolResultContent[];
  const isLastFullscreenApp = useLastFullscreenApp(messages, index, toolResultParts);

  const toolResult = toolResultParts[0]; // Usually just one

  const toolDef = useMemo(() => findTool(providers, toolResult?.name), [providers, toolResult?.name]);
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
  const toolOutput = toolResult?.result;
  const outputBlock = useMemo(
    () => (message.error || !toolOutput ? null : resolveToolOutput(toolDef, toolOutput)),
    [toolDef, message.error, toolOutput],
  );

  return (
    <div className={nested ? "max-w-full pb-1" : "max-w-full pb-2"}>
      <div className="max-w-full">
        <ActivityRow
          label={header.label}
          detail={header.preview}
          mono={header.mono}
          error={isToolError}
          icon={nested ? undefined : (header.Icon ?? toolDef?.icon)}
          expanded={toolResultExpanded}
          onToggle={() => setToolResultExpanded(!toolResultExpanded)}
        />

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
              outputBlock &&
              (outputBlock.language === "markdown" ? (
                <div className="ml-4.5 text-sm text-neutral-600 dark:text-neutral-400">
                  <Markdown compact>{outputBlock.code}</Markdown>
                </div>
              ) : (
                <CodeRenderer code={outputBlock.code} language={outputBlock.language} name={outputBlock.name} subtle />
              ))
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
