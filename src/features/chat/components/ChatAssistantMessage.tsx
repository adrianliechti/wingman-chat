import { SubagentCard } from "./SubagentCard";
import { AlertCircle, RotateCcw } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { ArtifactChip } from "@/features/artifacts/components/ArtifactChip";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { useChatActions, useChatConversation, useChatRunState } from "@/features/chat/hooks/useChat";
import { SkillChip } from "@/features/skills/components/SkillChip";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { shortModelName } from "@/shared/lib/models";
import type { ToolCallPart, UIMessage } from "@tanstack/ai";
import {
  finalText,
  isMediaPart,
  messageMetadata,
  messageText,
  toolResultFor,
  userMessage,
  type MessageMetadata,
} from "@/shared/lib/messages";
import type { ToolIcon } from "@/shared/types/chat";
import type { RunStatus } from "../context/ChatContext";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { ConvertButton } from "@/shared/ui/ConvertButton";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Markdown } from "@/shared/ui/Markdown";
import { PlayButton } from "@/shared/ui/PlayButton";
import { ActivityRow } from "./ActivityRow";
import { ChatMessageElicitation } from "./ChatMessageElicitation";
import { collectTurnArtifactPaths, collectTurnSkillNames, isTurnEnd, subagentToolCallIds } from "./chatMessageUtils";
import { ChatToolMessage } from "./ChatToolMessage";
import { getThinkingWord } from "./thinkingWord";
import { findTool, type ResolvedToolHeader, resolveToolHeader } from "./toolDisplay";

// Error message component
function ErrorMessage({
  title,
  message,
  actionLabel = "Retry",
  onAction,
  variant = "error",
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: "error" | "neutral";
}) {
  const displayTitle = title
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (l) => l.toUpperCase());
  const displayMessage = message || "An error occurred";

  return (
    <div className="flex justify-start pb-4">
      <div className="flex-1 py-3">
        <div
          className={cn(
            "rounded-lg border p-4 max-w-none",
            variant === "neutral"
              ? "border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900/40"
              : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20",
          )}
        >
          <div className="flex items-start gap-3">
            <AlertCircle
              className={cn(
                "w-5 h-5 shrink-0 mt-0.5",
                variant === "neutral" ? "text-neutral-500" : "text-red-500 dark:text-red-400",
              )}
            />
            <div className="flex-1 min-w-0">
              <h4
                className={cn(
                  "font-medium mb-1",
                  variant === "neutral" ? "text-neutral-800 dark:text-neutral-200" : "text-red-800 dark:text-red-200",
                )}
              >
                {displayTitle}
              </h4>
              <p
                className={cn(
                  "text-sm leading-relaxed",
                  variant === "neutral" ? "text-neutral-600 dark:text-neutral-300" : "text-red-700 dark:text-red-300",
                )}
              >
                {displayMessage}
              </p>
              {onAction && (
                <button
                  type="button"
                  onClick={onAction}
                  className={cn(
                    "mt-2 inline-flex items-center gap-1.5 text-xs font-medium transition-colors",
                    variant === "neutral"
                      ? "text-neutral-700 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white"
                      : "text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-100",
                  )}
                >
                  <RotateCcw className="w-3 h-3" />
                  {actionLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The "working" row shown before any reasoning or tool call arrives. */
function ThinkingIndicator({ status, runKey }: { status: RunStatus; runKey: string }) {
  const word = getThinkingWord(runKey);
  const label = status === "compacting" ? "Compacting conversation" : status === "waiting" ? "Waiting for input" : word;
  return <ActivityRow running label={`${label}…`} />;
}

// Reasoning/Thinking display component - shows model's thinking process in collapsible UI
type ReasoningDisplayProps = {
  reasoning: string;
  isStreaming?: boolean;
};

function ReasoningDisplay({ reasoning, isStreaming }: ReasoningDisplayProps) {
  // Start expanded when streaming, collapsed when viewing completed message
  const [isExpanded, setIsExpanded] = useState(isStreaming ?? false);
  // Track the previous streaming state to detect transitions
  const [prevIsStreaming, setPrevIsStreaming] = useState(isStreaming);

  // Adjust state during render when isStreaming prop changes
  // This is React's recommended pattern for updating state based on props
  if (isStreaming !== prevIsStreaming) {
    setPrevIsStreaming(isStreaming);
    // Expand when streaming starts, collapse when it ends
    setIsExpanded(!!isStreaming);
  }

  // Show component if we have reasoning content OR if we're streaming (thinking in progress)
  if (!reasoning && !isStreaming) return null;

  return (
    <div className={cn(isExpanded ? "mb-1" : "mb-0")}>
      <ActivityRow
        label={isStreaming ? "Thinking…" : "Thought"}
        running={isStreaming}
        expanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="mt-1 ml-4.5">
          <div className="text-sm text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">{reasoning}</div>
        </div>
      )}
    </div>
  );
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

/** Model + token usage of the completion that produced this turn (auto-router aware). */
function UsageInfo({ usage }: { usage: NonNullable<MessageMetadata["usage"]> }) {
  const parts: string[] = [];
  if (usage.model) parts.push(shortModelName(usage.model));
  if (usage.inputTokens != null) parts.push(`${formatTokens(usage.inputTokens)} in`);
  if (usage.outputTokens != null) parts.push(`${formatTokens(usage.outputTokens)} out`);
  if (parts.length === 0) return null;

  return <span className="text-xs text-neutral-400 dark:text-neutral-500 truncate">{parts.join(" · ")}</span>;
}

type ChatAssistantMessageProps = {
  message: UIMessage;
  index: number;
  isLast?: boolean;
  isResponding?: boolean;
};

function getMessagePartKey(part: UIMessage["parts"][number], index: number, scope: string) {
  switch (part.type) {
    case "thinking":
      return `${scope}:thinking:${part.stepId ?? index}`;
    case "tool-call":
      return `${scope}:tool-call:${part.id}`;
    case "tool-result":
      return `${scope}:tool-result:${part.toolCallId}`;
    case "subagent":
      return `${scope}:subagent:${part.subagent.id}`;
    default:
      return `${scope}:${part.type}:${index}`;
  }
}

/** A tool call still running at the top level of the turn. */
function RunningToolRow({
  header,
  icon,
  status,
  className,
}: {
  header: ResolvedToolHeader;
  icon?: ToolIcon;
  status?: string | null;
  className?: string;
}) {
  return (
    <ActivityRow
      running
      label={header.label}
      detail={status ?? header.preview}
      mono={header.mono}
      icon={header.Icon ?? icon}
      className={className}
    />
  );
}

export const ChatAssistantMessage = memo(function ChatAssistantMessage({
  message,
  index,
  isLast,
  isResponding,
}: ChatAssistantMessageProps) {
  const { messages, toolMeta } = useChatConversation();
  const { pendingElicitation, status } = useChatRunState();
  const { resolveElicitation, retryMessage, sendMessage } = useChatActions();
  const { providers } = useToolsContext();
  const { openFile, setShowArtifactsDrawer } = useArtifacts();

  const handleOpenArtifact = useCallback(
    (path: string) => {
      openFile(path);
      setShowArtifactsDrawer(true);
    },
    [openFile, setShowArtifactsDrawer],
  );

  // A ```ui block's "send" buttons continue the conversation as a normal user turn.
  const handleSendMessage = useCallback(
    (text: string) => {
      void sendMessage(userMessage(text)).catch((error) => console.error("Failed to send message", error));
    },
    [sendMessage],
  );

  // JS-driven hover (not CSS :hover) for the action bar — Safari leaves :hover
  // sticky after trackpad taps, so the buttons wouldn't reliably hide.
  const [hovered, setHovered] = useState(false);

  // Files written during this turn (file tools + execute_script), surfaced as
  // clickable chips on the turn's completion message rather than auto-opening
  // the artifacts drawer.
  const turnArtifactPaths = useMemo(
    () => (isTurnEnd(messages, index) ? collectTurnArtifactPaths(messages, index) : []),
    [messages, index],
  );

  const turnSkillNames = useMemo(
    () => (isTurnEnd(messages, index) ? collectTurnSkillNames(messages, index) : []),
    [messages, index],
  );

  const metadata = messageMetadata(message);
  const delegated = subagentToolCallIds(messages);
  const toolCallParts = message.parts.filter(
    (part): part is ToolCallPart => part.type === "tool-call" && !delegated.has(part.id),
  );
  const hasToolCalls = toolCallParts.length > 0;
  const hasTextContent = message.parts.some((part) => part.type === "text" && part.content);

  const mediaParts = message.parts.filter(isMediaPart);
  const hasMedia = mediaParts.length > 0;

  // Reasoning is actively streaming only if we're responding and no text/tool content has arrived yet
  const isReasoningActive = !!isLast && !!isResponding && !hasTextContent && !hasToolCalls;

  const config = getConfig();
  const enableTTS = !!config.tts;
  const textContent = finalText(message) || messageText(message);

  // Handle error messages
  if (metadata.error) {
    return (
      <ErrorMessage
        title={metadata.error.code || "Error"}
        message={metadata.error.message}
        actionLabel="Retry"
        onAction={isLast && !isResponding ? retryMessage : undefined}
      />
    );
  }

  const renderToolCall = (part: ToolCallPart, key: string, className?: string) => {
    const isPendingElicitation = pendingElicitation && pendingElicitation.toolCallId === part.id;
    if (isPendingElicitation) {
      return (
        <div key={key} className="my-2 rounded-lg overflow-hidden max-w-full">
          <ChatMessageElicitation
            toolName={pendingElicitation.toolName}
            elicitation={pendingElicitation.elicitation}
            waiting={pendingElicitation.waiting}
            completed={pendingElicitation.completed}
            onResolve={resolveElicitation}
          />
        </div>
      );
    }
    const result = toolResultFor(message, part.id);
    // A settled round keeps its row so its output is never lost between text segments.
    if (result)
      return (
        <div key={key} className={className}>
          <ChatToolMessage message={message} call={part} result={result} index={index} />
        </div>
      );
    // An unanswered call is only shown while it is still running.
    if (!isLast || !isResponding) return null;
    const meta = toolMeta[part.id];
    const liveStatus = typeof meta?.status === "string" ? meta.status : null;
    const tool = findTool(providers, part.name);
    const header = resolveToolHeader(tool, part.name, part.arguments, { running: true, toolCallId: part.id });
    return <RunningToolRow key={key} header={header} icon={tool?.icon} status={liveStatus} className={className} />;
  };

  // Handle loading states (no text content yet)
  if (!hasTextContent && !message.parts.some((part) => part.type === "subagent")) {
    const reasoningParts = message.parts.filter((part) => part.type === "thinking");
    const hasReasoning = reasoningParts.some((part) => part.content);

    // isReasoningActive is already false for non-last messages, so a single
    // helper covers the old / loading / streaming branches below.
    const renderReasoning = () =>
      reasoningParts.map((part, i) =>
        part.type === "thinking" ? (
          <ReasoningDisplay
            key={getMessagePartKey(part, i, "reasoning")}
            reasoning={part.content}
            isStreaming={isReasoningActive}
          />
        ) : null,
      );

    // Check if there's a pending elicitation for any of the tool calls
    const hasPendingElicitation =
      hasToolCalls &&
      toolCallParts.some((toolCall) => pendingElicitation && pendingElicitation.toolCallId === toolCall.id);

    // Keep a still-awaited elicitation prompt mounted even if a later result made this message not-last.
    if (!isLast && !hasPendingElicitation) {
      if (!hasReasoning && !hasToolCalls) return null;
      return (
        <div className="pb-2">
          {hasReasoning && renderReasoning()}
          {toolCallParts.map((part, i) => renderToolCall(part, getMessagePartKey(part, i, "tool-call")))}
        </div>
      );
    }

    // Show loading indicators for the last message when actively responding,
    // has a pending elicitation, or has reasoning content to display.
    if (!isResponding && !hasPendingElicitation && !hasReasoning && !hasToolCalls) {
      return null;
    }

    // Last message that's still working: reasoning, running tool rows, or the
    // thinking placeholder. One pb-2 wrapper (no top padding) so every state
    // sits at the same position as a committed tool row.
    return (
      <div className="pb-2">
        {hasReasoning && renderReasoning()}
        {hasToolCalls
          ? toolCallParts.map((part, i) => renderToolCall(part, getMessagePartKey(part, i, "loading-tool-call")))
          : !hasReasoning && (
              <ThinkingIndicator status={status} runKey={metadata.runId ?? message.id ?? String(index)} />
            )}
      </div>
    );
  }

  // Render assistant message with content
  return (
    <div
      className="flex justify-start pb-2 text-neutral-900 dark:text-neutral-200"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={cn("flex-1 [overflow-wrap:anywhere] min-w-0 overflow-hidden", hasTextContent && "py-3")}>
        {/* Render content parts in order */}
        {message.parts.map((part, partIndex) => {
          const partKey = getMessagePartKey(part, partIndex, "content");

          if (part.type === "subagent") return <SubagentCard key={partKey} {...part.subagent} />;
          if (part.type === "thinking") {
            return <ReasoningDisplay key={partKey} reasoning={part.content} isStreaming={isReasoningActive} />;
          }
          if (part.type === "text") {
            if (!part.content) return null;
            const hasPrecedingItems = message.parts
              .slice(0, partIndex)
              .some((p) => p.type === "thinking" || p.type === "tool-call");
            return (
              <div key={partKey} className={cn(hasPrecedingItems && "mt-2")}>
                <Markdown
                  isStreaming={!!(isLast && isResponding)}
                  onOpenArtifact={handleOpenArtifact}
                  onSendMessage={handleSendMessage}
                >
                  {part.content}
                </Markdown>
              </div>
            );
          }
          if (part.type === "tool-call") {
            if (delegated.has(part.id)) return null;
            // Only the first tool call in a run gets top spacing (to match the
            // committed result's gap); consecutive concurrent calls stay tight.
            const isFirstToolCall = message.parts[partIndex - 1]?.type !== "tool-call";
            return renderToolCall(part, partKey, isFirstToolCall ? "mt-2" : "mt-1");
          }
          return null;
        })}

        {hasMedia && (
          <div className="pt-2">
            <RenderContents contents={mediaParts} />
          </div>
        )}

        {turnArtifactPaths.length > 0 && (
          <div className="mt-3 mb-2 flex flex-wrap gap-2">
            {turnArtifactPaths.map((path) => (
              <ArtifactChip key={path} path={path} />
            ))}
          </div>
        )}

        {turnSkillNames.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {turnSkillNames.map((name) => (
              <SkillChip key={name} name={name} />
            ))}
          </div>
        )}

        {hasTextContent && !(isLast && isResponding) && (
          <div
            className={cn(
              "flex items-center gap-3 mt-1 transition-opacity duration-200",
              // Keep the latest completed reply's actions visible; reveal older ones on hover.
              isLast && !isResponding ? "opacity-100" : hovered ? "opacity-100" : "opacity-100 md:opacity-0",
            )}
          >
            <div className="flex items-center gap-2 shrink-0">
              <CopyButton markdown={textContent} className="h-4 w-4" />
              <ConvertButton markdown={textContent} className="h-4 w-4" />
              {enableTTS && <PlayButton text={textContent} className="h-4 w-4" />}
            </div>
            {isLast && !isResponding && metadata.usage && <UsageInfo usage={metadata.usage} />}
          </div>
        )}
      </div>
    </div>
  );
});
