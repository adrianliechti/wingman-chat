import type { ToolCallPart, ToolResultPart, UIMessage } from "@tanstack/ai";
import { memo, useMemo, useState } from "react";
import { useChatConversation } from "@/features/chat/hooks/useChat";
import { useLastFullscreenApp } from "@/features/chat/hooks/useLastFullscreenApp";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { isMediaPart, toolResultContent, toolResultMetadata } from "@/shared/lib/messages";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { Markdown } from "@/shared/ui/Markdown";
import { ActivityRow } from "./ActivityRow";
import { McpApp } from "./McpApp";
import { findTool, resolveToolHeader, resolveToolInput, resolveToolOutput } from "./toolDisplay";

type ChatToolMessageProps = {
  /** The assistant message that holds the round. */
  message: UIMessage;
  call: ToolCallPart;
  result?: ToolResultPart;
  index: number;
  messages?: UIMessage[];
  /** Inside a group or subagent: no icon, the parent row already names the activity. */
  nested?: boolean;
};

/** One completed tool round: a collapsible row with its input, output, media, and MCP app. */
export const ChatToolMessage = memo(function ChatToolMessage({
  message,
  call,
  result,
  index,
  messages: scope,
  nested,
}: ChatToolMessageProps) {
  const [toolResultExpanded, setToolResultExpanded] = useState(false);
  const { chat, messages: chatMessages } = useChatConversation();
  const messages = scope ?? chatMessages;
  const { providers } = useToolsContext();
  const isLastFullscreenApp = useLastFullscreenApp(messages, index, result);

  const data = result ? toolResultMetadata(result) : {};
  const toolDef = useMemo(() => findTool(providers, call.name), [providers, call.name]);
  const error =
    data.error ?? (result?.state === "error" ? { code: "TOOL_ERROR", message: result.error ?? "" } : undefined);
  const isToolError = !!error;
  // When a result carries an MCP UI app, the app is the primary renderer; per the
  // MCP Apps spec the `content` blocks are for model context / text-only fallback,
  // so we don't also render the (redundant) media inline.
  //
  // We also require the app's provider to be registered: restoring a chat whose app
  // belongs to an inactive agent (or an MCP filtered out by RBAC) means the client
  // isn't available, so we fall back to the raw result instead of a broken app. Once
  // the provider appears (e.g. the agent is activated) this flips true and McpApp mounts.
  const appProviderId = data.meta?.toolProvider;
  const hasMcpApp =
    typeof appProviderId === "string" &&
    typeof data.meta?.toolResource === "string" &&
    providers.some((p) => p.id === appProviderId);
  const header = resolveToolHeader(toolDef, call.name, call.arguments, { error: isToolError });
  const inputBlocks = useMemo(() => resolveToolInput(toolDef, call.arguments), [toolDef, call.arguments]);
  const toolOutput = useMemo(() => (result ? toolResultContent(result) : undefined), [result]);
  const outputBlock = useMemo(
    () => (error || !toolOutput ? null : resolveToolOutput(toolDef, toolOutput)),
    [toolDef, error, toolOutput],
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
            {error ? (
              <CodeRenderer code={error.message} language="text" name="Error" subtle />
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
        {!hasMcpApp && toolOutput?.some(isMediaPart) && (
          <div className="mt-2">
            <RenderContents contents={toolOutput} />
          </div>
        )}

        {/* Render the MCP UI app (inline or fullscreen) for tool results with UI metadata */}
        {hasMcpApp && result && (
          <McpApp
            key={`${chat?.id}-${message.id}-${call.id}`}
            call={call}
            result={result}
            isLastFullscreenApp={isLastFullscreenApp}
          />
        )}
      </div>
    </div>
  );
});
