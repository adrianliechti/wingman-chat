import { AlertCircle, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { ArtifactChip } from "@/features/artifacts/components/ArtifactChip";
import { useChat } from "@/features/chat/hooks/useChat";
import { SkillChip } from "@/features/skills/components/SkillChip";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { shortModelName } from "@/shared/lib/models";
import type { Content, Message } from "@/shared/types/chat";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { ConvertButton } from "@/shared/ui/ConvertButton";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Markdown } from "@/shared/ui/Markdown";
import { PlayButton } from "@/shared/ui/PlayButton";
import { ChatMessageElicitation } from "./ChatMessageElicitation";
import { collectTurnArtifactPaths, collectTurnSkillNames, isTurnEnd } from "./chatMessageUtils";
import { findTool, type ResolvedToolHeader, resolveToolHeader } from "./toolDisplay";

// Error message component
function ErrorMessage({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  const displayTitle = title
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (l) => l.toUpperCase());
  const displayMessage = message || "An error occurred";

  return (
    <div className="flex justify-start pb-4">
      <div className="flex-1 py-3">
        <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 rounded-lg p-4 max-w-none">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-red-800 dark:text-red-200 mb-1">{displayTitle}</h4>
              <p className="text-sm text-red-700 dark:text-red-300 leading-relaxed">{displayMessage}</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// A rotating, playful verb for the "model is working" indicator. Picked once per
// mount so it stays put while a turn streams, but varies between turns.
// Inspired by Claude Code's spinner verbs.
const THINKING_WORDS = [
  "Thinking",
  "Pondering",
  "Mulling",
  "Noodling",
  "Reasoning",
  "Cogitating",
  "Ruminating",
  "Percolating",
  "Contemplating",
  "Considering",
  "Deliberating",
  "Deciphering",
  "Brewing",
  "Churning",
  "Conjuring",
  "Concocting",
  "Distilling",
  "Envisioning",
  "Hatching",
  "Ideating",
  "Imagining",
  "Incubating",
  "Inferring",
  "Marinating",
  "Musing",
  "Orchestrating",
  "Puzzling",
  "Scheming",
  "Simmering",
  "Sketching",
  "Stewing",
  "Synthesizing",
  "Tinkering",
  "Untangling",
  "Wrangling",
];

/** Spinner + label "working" indicator — identical box to a running tool row. */
function ThinkingIndicator() {
  const [word] = useState(() => THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)]);
  return (
    <div className="rounded-lg overflow-hidden max-w-full">
      <div className="flex items-center gap-2 min-w-0">
        <Loader2 className="w-3 h-3 animate-spin text-slate-400 dark:text-slate-500 shrink-0" />
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{word}…</span>
      </div>
    </div>
  );
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
  const label = isStreaming ? "Thinking..." : isExpanded ? "Hide Thoughts" : "Expand Thoughts";

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
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="grid w-full grid-cols-[12px_minmax(0,1fr)] items-center gap-1.5 text-left text-xs text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
      >
        <ChevronRight className={cn("w-3 h-3 transition-transform duration-200", isExpanded && "rotate-90")} />
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium">{label}</span>
          {isStreaming && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
        </span>
      </button>

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
function UsageInfo({ usage }: { usage: NonNullable<Message["usage"]> }) {
  const parts: string[] = [];
  if (usage.model) parts.push(shortModelName(usage.model));
  if (usage.inputTokens != null) parts.push(`${formatTokens(usage.inputTokens)} in`);
  if (usage.outputTokens != null) parts.push(`${formatTokens(usage.outputTokens)} out`);
  if (parts.length === 0) return null;

  return <span className="text-xs text-neutral-400 dark:text-neutral-500 truncate">{parts.join(" · ")}</span>;
}

type ChatAssistantMessageProps = {
  message: Message;
  index: number;
  isLast?: boolean;
  isResponding?: boolean;
};

function getMessagePartKey(part: Message["content"][number], index: number, scope: string) {
  switch (part.type) {
    case "reasoning":
      return `${scope}:reasoning:${part.id}`;
    case "tool_call":
      return `${scope}:tool_call:${part.id}`;
    case "text":
      return `${scope}:text:${index}`;
    default:
      return `${scope}:${part.type}:${index}`;
  }
}

/** Compact row shown while a tool call is still running (spinner + label + status/preview). */
function RunningToolRow({
  header,
  status,
  className,
}: {
  header: ResolvedToolHeader;
  status?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg overflow-hidden max-w-full", className)}>
      <div className="flex items-center gap-2 min-w-0">
        <Loader2 className="w-3 h-3 animate-spin text-slate-400 dark:text-slate-500 shrink-0" />
        <span
          className={cn(
            "text-xs whitespace-nowrap text-neutral-500 dark:text-neutral-400",
            header.mono ? "font-mono truncate" : "font-medium",
          )}
        >
          {header.label}
        </span>
        {status ? (
          <span className="text-xs italic text-neutral-500 dark:text-neutral-400 truncate">{status}</span>
        ) : header.preview ? (
          <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">{header.preview}</span>
        ) : null}
      </div>
    </div>
  );
}

export const ChatAssistantMessage = memo(function ChatAssistantMessage({
  message,
  index,
  isLast,
  isResponding,
}: ChatAssistantMessageProps) {
  const { messages, pendingElicitation, resolveElicitation, retryMessage, toolMeta } = useChat();
  const { providers } = useToolsContext();

  // JS-driven hover (not CSS :hover) for the action bar — Safari leaves :hover
  // sticky after trackpad taps, so the buttons wouldn't reliably hide.
  const [hovered, setHovered] = useState(false);

  // Files written during this turn (create_file + python/javascript), surfaced as
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

  const toolCallParts = message.content.filter((p) => p.type === "tool_call");
  const hasToolCalls = toolCallParts.length > 0;
  const hasTextContent = message.content.some((p) => p.type === "text" && p.text);

  const mediaParts = message.content.filter(
    (p) => p.type === "image" || p.type === "file" || p.type === "audio",
  ) as Content[];
  const hasMedia = mediaParts.length > 0;

  // Reasoning is actively streaming only if we're responding and no text/tool content has arrived yet
  const isReasoningActive = isLast && isResponding && !hasTextContent && !hasToolCalls;

  const config = getConfig();
  const enableTTS = !!config.tts;
  const textContent = message.content.find((p) => p.type === "text")?.text ?? "";

  // Handle error messages
  if (message.error) {
    return (
      <ErrorMessage
        title={message.error.code || "Error"}
        message={message.error.message}
        onRetry={isLast && !isResponding ? retryMessage : undefined}
      />
    );
  }

  // Handle loading states (no text content yet)
  if (!hasTextContent) {
    const reasoningParts = message.content.filter((p) => p.type === "reasoning");
    const hasReasoning = reasoningParts.some((p) => p.text || p.summary);

    // isReasoningActive is already false for non-last messages, so a single
    // helper covers the old / loading / streaming branches below.
    const renderReasoning = () =>
      reasoningParts.map((part, i) =>
        part.type === "reasoning" ? (
          <ReasoningDisplay
            key={getMessagePartKey(part, i, "reasoning")}
            reasoning={part.text || part.summary || ""}
            isStreaming={isReasoningActive}
          />
        ) : null,
      );

    // For old messages (not last), only show if there's reasoning to display
    if (!isLast) {
      if (!hasReasoning) return null;
      return <div className="pb-2">{renderReasoning()}</div>;
    }

    // Check if there's a pending elicitation for any of the tool calls
    const hasPendingElicitation =
      hasToolCalls &&
      toolCallParts.some(
        (toolCall) =>
          toolCall.type === "tool_call" && pendingElicitation && pendingElicitation.toolCallId === toolCall.id,
      );

    // Show loading indicators for the last message when actively responding,
    // has a pending elicitation, or has reasoning content to display.
    if (!isResponding && !hasPendingElicitation && !hasReasoning) {
      return null;
    }

    // Last message that's still working: reasoning, running tool rows, or the
    // thinking placeholder. One pb-2 wrapper (no top padding) so every state
    // sits at the same position as a committed tool row.
    return (
      <div className="pb-2">
        {hasReasoning && renderReasoning()}
        {hasToolCalls
          ? toolCallParts.map((part, i) => {
              if (part.type !== "tool_call") return null;
              const isPendingElicitation = pendingElicitation && pendingElicitation.toolCallId === part.id;

              if (isPendingElicitation) {
                return (
                  <ChatMessageElicitation
                    key={getMessagePartKey(part, i, "loading-tool-call")}
                    toolName={pendingElicitation.toolName}
                    elicitation={pendingElicitation.elicitation}
                    waiting={pendingElicitation.waiting}
                    completed={pendingElicitation.completed}
                    onResolve={resolveElicitation}
                  />
                );
              }

              const meta = toolMeta[part.id];
              const status = typeof meta?.status === "string" ? meta.status : null;
              const header = resolveToolHeader(findTool(providers, part.name), part.name, part.arguments, {
                running: true,
              });
              return (
                <RunningToolRow key={getMessagePartKey(part, i, "loading-tool-call")} header={header} status={status} />
              );
            })
          : !hasReasoning && <ThinkingIndicator />}
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
      <div className="flex-1 py-3 [overflow-wrap:anywhere] min-w-0 overflow-hidden">
        {/* Render content parts in order */}
        {message.content.map((part, index) => {
          const partKey = getMessagePartKey(part, index, "content");

          if (part.type === "reasoning") {
            return (
              <ReasoningDisplay
                key={partKey}
                reasoning={part.text || part.summary || ""}
                isStreaming={isReasoningActive}
              />
            );
          }
          if (part.type === "text") {
            const hasPrecedingItems = message.content
              .slice(0, index)
              .some((p) => p.type === "reasoning" || p.type === "tool_call");
            return (
              <div key={partKey} className={cn(hasPrecedingItems && "mt-2")}>
                <Markdown isStreaming={!!(isLast && isResponding)}>{part.text}</Markdown>
              </div>
            );
          }
          if (part.type === "tool_call") {
            const isPendingElicitation = pendingElicitation && pendingElicitation.toolCallId === part.id;

            if (isPendingElicitation) {
              return (
                <div key={partKey} className="my-2 rounded-lg overflow-hidden max-w-full">
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

            // Tool calls shown inline only when streaming
            if (!isLast || !isResponding) return null;
            const header = resolveToolHeader(findTool(providers, part.name), part.name, part.arguments, {
              running: true,
            });
            // Only the first tool call in a run gets top spacing (to match the
            // committed result's gap); consecutive concurrent calls stay tight.
            const isFirstToolCall = message.content[index - 1]?.type !== "tool_call";
            return (
              <RunningToolRow
                key={partKey}
                header={header}
                className={cn("mb-0", isFirstToolCall ? "mt-2" : "mt-0.5")}
              />
            );
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

        <div
          className={cn(
            "flex items-center gap-3 mt-1 transition-opacity duration-200",
            // The completed last message keeps its actions always visible; while it's
            // still streaming, hover-gate them (avoids flicker as content reflows).
            isLast && !isResponding ? "opacity-100" : hovered ? "opacity-100" : "opacity-100 md:opacity-0",
          )}
        >
          <div className="flex items-center gap-2 shrink-0">
            <CopyButton markdown={textContent} className="h-4 w-4" />
            <ConvertButton markdown={textContent} className="h-4 w-4" />
            {enableTTS && <PlayButton text={textContent} className="h-4 w-4" />}
          </div>
          {isLast && !isResponding && message.usage && <UsageInfo usage={message.usage} />}
        </div>
      </div>
    </div>
  );
});
