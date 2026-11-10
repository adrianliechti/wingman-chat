import type { ToolCallPart, ToolResultPart, UIMessage } from "@tanstack/ai";
import { lazy, memo, Suspense, useMemo, useState } from "react";
import { useChatActions, useChatConversation } from "@/features/chat/hooks/useChat";
import { useLastFullscreenApp } from "@/features/chat/hooks/useLastFullscreenApp";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { isMediaPart, toolResultContent, uiResourceFor, userMessage } from "@/shared/lib/messages";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { Markdown } from "@/shared/ui/Markdown";
import { ActivityRow } from "./ActivityRow";
import { findTool, resolveToolHeader, resolveToolInput, resolveToolOutput } from "./toolDisplay";

const McpApp = lazy(() => import("./McpApp").then((module) => ({ default: module.McpApp })));

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
  const { sendMessage } = useChatActions();
  const messages = scope ?? chatMessages;
  const { providers } = useToolsContext();
  const app = uiResourceFor(message, call.id);
  const isLastFullscreenApp = useLastFullscreenApp(messages, index, app);

  const toolDef = useMemo(() => findTool(providers, call.name), [providers, call.name]);
  const error = result?.state === "error" ? { code: "TOOL_ERROR", message: result.error ?? "" } : undefined;
  const isToolError = !!error && !result?.outcome;
  // When a result carries an MCP UI app, the app is the primary renderer; per the
  // MCP Apps spec the `content` blocks are for model context / text-only fallback,
  // so we don't also render the (redundant) media inline.
  //
  // We also require the app's provider to be registered: restoring a chat whose app
  // belongs to an inactive agent (or an MCP filtered out by RBAC) means the client
  // isn't available, so we fall back to the raw result instead of a broken app. Once
  // the provider appears (e.g. the agent is activated) this flips true and McpApp mounts.
  const appProviderId = app?.serverId;
  const hasMcpApp =
    typeof appProviderId === "string" &&
    app?.resource.uri.startsWith("ui://") &&
    providers.some((p) => p.id === appProviderId);
  const inputBlocks = useMemo(() => resolveToolInput(toolDef, call.arguments), [toolDef, call.arguments]);
  const toolOutput = useMemo(() => (result ? toolResultContent(result) : undefined), [result]);
  const header = resolveToolHeader(toolDef, call.name, call.arguments, {
    error: isToolError,
    result: toolOutput,
    outcome: result?.outcome,
  });
  const outputBlock = useMemo(
    () => (error || !toolOutput ? null : resolveToolOutput(toolDef, toolOutput, call.arguments)),
    [toolDef, error, toolOutput, call.arguments],
  );

  return (
    <div className="max-w-full">
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
          <div className="space-y-1 pb-1">
            {/* Input — the tool's blocks, or a best-effort arguments block */}
            {inputBlocks.map((block) =>
              block.language === "markdown" || block.language === "text" ? (
                <div
                  key={block.name ?? block.language}
                  className="ml-4.5 text-sm text-neutral-600 dark:text-neutral-400"
                >
                  {block.name && (
                    <p className="mb-1 text-xs font-medium text-neutral-400 dark:text-neutral-500">{block.name}</p>
                  )}
                  {block.language === "text" ? (
                    <p className="whitespace-pre-wrap break-words">{block.code}</p>
                  ) : (
                    <Markdown compact>{block.code}</Markdown>
                  )}
                </div>
              ) : (
                <div key={block.name ?? block.language} className="ml-4.5">
                  <CodeRenderer code={block.code} language={block.language} name={block.name} subtle />
                </div>
              ),
            )}
            {/* Output — the error, or the tool's / best-effort result block */}
            {error ? (
              <div className="ml-4.5">
                <CodeRenderer code={error.message} language="text" name="Error" subtle />
              </div>
            ) : (
              outputBlock &&
              (outputBlock.language === "markdown" ? (
                <div className="ml-4.5 text-sm text-neutral-600 dark:text-neutral-400">
                  <Markdown compact>{outputBlock.code}</Markdown>
                </div>
              ) : (
                <div className="ml-4.5">
                  <CodeRenderer
                    code={outputBlock.code}
                    language={outputBlock.language}
                    name={outputBlock.name}
                    subtle
                  />
                </div>
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

        {/* Render the native UI resource alongside its originating tool result. */}
        {hasMcpApp && app && result && (
          <Suspense
            fallback={
              <div className="p-3 text-sm text-neutral-500" role="status">
                Loading app…
              </div>
            }
          >
            <McpApp
              key={`${chat?.id}-${message.id}-${call.id}`}
              call={call}
              app={app}
              result={result}
              isLastFullscreenApp={isLastFullscreenApp}
              onPrompt={(text) => sendMessage(userMessage(text))}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
});
