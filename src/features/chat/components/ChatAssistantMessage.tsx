import { AlertCircle, ChevronRight, Loader2 } from "lucide-react";
import { memo, useState } from "react";
import { useChat } from "@/features/chat/hooks/useChat";
import { getConfig } from "@/shared/config";
import { getToolDisplayName } from "@/shared/lib/utils";
import type { Content, Message } from "@/shared/types/chat";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { ConvertButton } from "@/shared/ui/ConvertButton";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Markdown } from "@/shared/ui/Markdown";
import { PlayButton } from "@/shared/ui/PlayButton";
import { ChatMessageElicitation } from "./ChatMessageElicitation";
import { getToolCallPreview } from "./chatMessageUtils";

// Error message component
function ErrorMessage({ title, message }: { title: string; message: string }) {
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
            </div>
          </div>
        </div>
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
    <div className={isExpanded ? "mb-1" : "mb-0"}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="grid w-full grid-cols-[12px_minmax(0,1fr)] items-center gap-1.5 text-left text-xs text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
      >
        <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
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

export const ChatAssistantMessage = memo(function ChatAssistantMessage({
  message,
  isLast,
  isResponding,
}: ChatAssistantMessageProps) {
  const { pendingElicitation, resolveElicitation } = useChat();

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
    return <ErrorMessage title={message.error.code || "Error"} message={message.error.message} />;
  }

  // Handle loading states (no text content yet)
  if (!hasTextContent) {
    const reasoningParts = message.content.filter((p) => p.type === "reasoning");
    const hasReasoning = reasoningParts.length > 0 && reasoningParts.some((p) => p.text || p.summary);

    // For old messages (not last), only show if there's reasoning to display
    if (!isLast) {
      if (!hasReasoning) return null;
      return (
        <div className="pb-2">
          {reasoningParts.map(
            (part, index) =>
              part.type === "reasoning" && (
                <ReasoningDisplay
                  key={getMessagePartKey(part, index, "old-reasoning")}
                  reasoning={part.text || part.summary || ""}
                  isStreaming={false}
                />
              ),
          )}
        </div>
      );
    }

    // Check if there's a pending elicitation for any of the tool calls
    const hasPendingElicitation =
      hasToolCalls &&
      toolCallParts.some(
        (toolCall) =>
          toolCall.type === "tool_call" && pendingElicitation && pendingElicitation.toolCallId === toolCall.id,
      );

    // Show loading indicators for the last message when actively responding,
    // has pending elicitation, or has reasoning content to display
    if (!isLast || (!isResponding && !hasPendingElicitation && !hasReasoning)) {
      return null;
    }

    // Show tool call indicators if there are tool calls
    if (hasToolCalls) {
      return (
        <div className="pb-2">
          {/* Show reasoning above tool calls */}
          {hasReasoning &&
            reasoningParts.map(
              (part, index) =>
                part.type === "reasoning" && (
                  <ReasoningDisplay
                    key={getMessagePartKey(part, index, "loading-reasoning")}
                    reasoning={part.text || part.summary || ""}
                    isStreaming={isReasoningActive}
                  />
                ),
            )}
          <div className="mt-0 space-y-0">
            {toolCallParts.map((part, index) => {
              if (part.type !== "tool_call") return null;
              const toolCall = part;
              const preview = getToolCallPreview(toolCall.name, toolCall.arguments);
              const isPendingElicitation = pendingElicitation && pendingElicitation.toolCallId === toolCall.id;

              // Show elicitation prompt if this tool call has a pending elicitation
              if (isPendingElicitation) {
                return (
                  <ChatMessageElicitation
                    key={getMessagePartKey(toolCall, index, "loading-tool-call")}
                    toolName={pendingElicitation.toolName}
                    elicitation={pendingElicitation.elicitation}
                    waiting={pendingElicitation.waiting}
                    completed={pendingElicitation.completed}
                    onResolve={resolveElicitation}
                  />
                );
              }

              return (
                <div
                  key={getMessagePartKey(toolCall, index, "loading-tool-call")}
                  className="rounded-lg overflow-hidden max-w-full"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Loader2 className="w-3 h-3 animate-spin text-slate-400 dark:text-slate-500 shrink-0" />
                    <span className="text-xs font-medium whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                      {getToolDisplayName(toolCall.name)}
                    </span>
                    {preview && (
                      <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">
                        {preview}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // Show loading animation or reasoning for regular assistant responses
    return (
      <div className="pb-4">
        {hasReasoning ? (
          reasoningParts.map(
            (part, index) =>
              part.type === "reasoning" && (
                <ReasoningDisplay
                  key={getMessagePartKey(part, index, "streaming-reasoning")}
                  reasoning={part.text || part.summary || ""}
                  isStreaming={isReasoningActive}
                />
              ),
          )
        ) : (
          <div className="space-y-2">
            <div className="flex space-x-1">
              <div
                className="h-2 w-2 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce"
                style={{ animationDelay: "0ms" }}
              ></div>
              <div
                className="h-2 w-2 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce"
                style={{ animationDelay: "150ms" }}
              ></div>
              <div
                className="h-2 w-2 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce"
                style={{ animationDelay: "300ms" }}
              ></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Render assistant message with content
  return (
    <div
      className={`flex justify-start pb-2 ${isResponding && isLast ? "" : "group"} text-neutral-900 dark:text-neutral-200`}
    >
      <div className="flex-1 py-3 wrap-break-words overflow-x-auto">
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
              <div key={partKey} className={hasPrecedingItems ? "mt-2" : ""}>
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
            const preview = getToolCallPreview(part.name, part.arguments);
            return (
              <div key={partKey} className="mt-0.5 mb-0 rounded-lg overflow-hidden max-w-full">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="w-3 h-3 animate-spin text-slate-400 dark:text-slate-500 shrink-0" />
                  <span className="text-xs font-medium whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                    {getToolDisplayName(part.name)}
                  </span>
                  {preview && (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">{preview}</span>
                  )}
                </div>
              </div>
            );
          }
          return null;
        })}

        {hasMedia && (
          <div className="pt-2">
            <RenderContents contents={mediaParts} />
          </div>
        )}

        <div className="flex justify-between items-center mt-1 transition-opacity duration-200 opacity-0 group-hover:opacity-100">
          <div className="flex items-center gap-2">
            <CopyButton markdown={textContent} className="h-4 w-4" />
            <ConvertButton markdown={textContent} className="h-4 w-4" />
            {enableTTS && <PlayButton text={textContent} className="h-4 w-4" />}
          </div>
        </div>
      </div>
    </div>
  );
});
