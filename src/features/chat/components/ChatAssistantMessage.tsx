import { SubagentCard } from "./SubagentCard";
import { AlertCircle, RotateCcw, Sparkles } from "lucide-react";
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
  toolCallProgress,
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
import { ReasoningDisplay } from "./ReasoningDisplay";
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

/** The "working" row while the model has nothing to show yet: before its first output, or after tool results. */
function ThinkingIndicator({ status, runKey }: { status: RunStatus; runKey: string }) {
  const word = getThinkingWord(runKey);
  const label = status === "compacting" ? "Compacting conversation" : status === "waiting" ? "Waiting for input" : word;
  return <ActivityRow running icon={Sparkles} label={`${label}…`} />;
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
  /** Opening reasoning already shown in the preceding tool group. */
  foldedReasoning?: boolean;
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
  className,
}: {
  header: ResolvedToolHeader;
  icon?: ToolIcon;
  className?: string;
}) {
  return (
    <ActivityRow
      running
      label={header.label}
      detail={header.preview}
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
  foldedReasoning,
}: ChatAssistantMessageProps) {
  const { chat, messages } = useChatConversation();
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

  // Thinking can resume after tools in the same message; only the latest output is active.
  const activeThinking =
    isLast && isResponding
      ? message.parts.findLast(
          (part) => part.type === "thinking" || part.type === "tool-call" || (part.type === "text" && part.content),
        )
      : undefined;
  // Every tool has returned and nothing newer has streamed: the model is working on its next step.
  const lastPart = message.parts.findLast(
    (part) => part.type !== "tool-result" && !(part.type === "text" && !part.content),
  );
  const isAwaitingModel =
    !!isLast &&
    !!isResponding &&
    lastPart?.type === "tool-call" &&
    toolCallParts.every((part) => toolResultFor(message, part.id));

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
    const tool = findTool(providers, part.name);
    const header = resolveToolHeader(tool, part.name, part.arguments, {
      running: true,
      toolCallId: part.id,
      progress: toolCallProgress(part),
    });
    return <RunningToolRow key={key} header={header} icon={tool?.icon} className={className} />;
  };

  // Handle loading states (no text content yet)
  if (!hasTextContent && !message.parts.some((part) => part.type === "subagent")) {
    const hasReasoning = message.parts.some(
      (part) => part.type === "thinking" && (part.content || part === activeThinking),
    );
    if (!hasReasoning && !hasToolCalls && !(isLast && isResponding)) return null;

    // Keep thoughts, tools and pending elicitation in arrival order. Activity
    // rows carry their own spacing; only the last message gets a placeholder.
    return (
      <div>
        {message.parts.map((part, partIndex) => {
          const key = getMessagePartKey(part, partIndex, "activity");
          if (part.type === "thinking")
            return <ReasoningDisplay key={key} reasoning={part.content} isStreaming={part === activeThinking} />;
          if (part.type === "tool-call" && !delegated.has(part.id)) return renderToolCall(part, key);
          return null;
        })}
        {isLast && ((!hasToolCalls && !hasReasoning) || isAwaitingModel) && (
          <ThinkingIndicator status={status} runKey={metadata.runId ?? message.id ?? String(index)} />
        )}
      </div>
    );
  }

  // The opening reasoning moved into the preceding tool group.
  const foldedParts = foldedReasoning ? message.parts.findIndex((part) => part.type !== "thinking") : 0;

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
            if (partIndex < foldedParts) return null;
            return <ReasoningDisplay key={partKey} reasoning={part.content} isStreaming={part === activeThinking} />;
          }
          if (part.type === "text") {
            if (!part.content) return null;
            const hasPrecedingItems = message.parts
              .slice(foldedParts, partIndex)
              .some((p) => p.type === "thinking" || p.type === "tool-call");
            return (
              <div key={partKey} className={cn(hasPrecedingItems && "mt-2")}>
                <Markdown
                  isStreaming={!!(isLast && isResponding)}
                  onOpenArtifact={handleOpenArtifact}
                  onSendMessage={handleSendMessage}
                  uiStateKey={chat?.id ? JSON.stringify([chat.id, message.id, partIndex]) : undefined}
                >
                  {part.content}
                </Markdown>
              </div>
            );
          }
          if (part.type === "tool-call") {
            if (delegated.has(part.id)) return null;
            // Rows stack flush; only a row that follows text needs a gap.
            const previous = message.parts[partIndex - 1];
            return renderToolCall(part, partKey, previous?.type === "text" && previous.content ? "mt-2" : undefined);
          }
          return null;
        })}
        {isAwaitingModel && (
          <ThinkingIndicator status={status} runKey={metadata.runId ?? message.id ?? String(index)} />
        )}

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
