import { ToolCase } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { UIMessage } from "@tanstack/ai";
import { leadingReasoning, subagentToolCallIds, summarizeActivity, toolRounds } from "./chatMessageUtils";
import { ActivityRow } from "./ActivityRow";
import { ChatToolMessage } from "./ChatToolMessage";
import { ReasoningDisplay } from "./ReasoningDisplay";
import { ChatMessageAttachments } from "./ChatMessageAttachments";
import { hasStoredAttachments } from "../lib/chatAttachments";

type ChatToolGroupProps = {
  messages: UIMessage[];
  indices: number[];
  /** The reply whose opening reasoning this group folds. */
  reply?: number;
};

/** The reasoning and every tool round of one message, exactly as they read before folding. */
function ToolRows({ message, index, messages }: { message: UIMessage; index: number; messages: UIMessage[] }) {
  const delegated = subagentToolCallIds(messages);
  const rounds = new Map(toolRounds(message, delegated).map((round) => [round.call.id, round]));
  return (
    <>
      {message.parts.map((part, partIndex) => {
        if (part.type === "thinking")
          return <ReasoningDisplay key={`thinking:${part.stepId ?? partIndex}`} reasoning={part.content} />;
        if (part.type !== "tool-call") return null;
        const round = rounds.get(part.id);
        return round ? (
          <ChatToolMessage key={part.id} message={message} call={round.call} result={round.result} index={index} />
        ) : null;
      })}
    </>
  );
}

/**
 * Folds a run of finished tool rounds, with any reasoning between them, into a
 * single collapsible "Used N tools" row. Expanding reveals the individual ChatToolMessage rows, each still
 * independently expandable.
 *
 * Stays collapsed by default — and never auto-expands/collapses — so the layout
 * height doesn't change as a turn finishes (that shift fought the scroll hold
 * and made the viewport jump). Live progress is shown by the running tool row
 * and the activity dots instead.
 */
export const ChatToolGroup = memo(function ChatToolGroup({ messages, indices, reply }: ChatToolGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeActivity(messages, indices, reply), [messages, indices, reply]);

  return (
    <div className="max-w-full">
      <ActivityRow
        label={summary}
        icon={ToolCase}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />

      {expanded && (
        <div className="pl-4.5">
          {indices.map((idx) => {
            const message = messages[idx];
            return hasStoredAttachments(message) ? (
              <ChatMessageAttachments key={message.id} message={message}>
                {(loaded) => <ToolRows message={loaded} index={idx} messages={messages} />}
              </ChatMessageAttachments>
            ) : (
              <ToolRows key={message.id} message={message} index={idx} messages={messages} />
            );
          })}
          {leadingReasoning(messages[reply ?? -1]).map((reasoning, index) => (
            <ReasoningDisplay key={`reply-${index}`} reasoning={reasoning} />
          ))}
        </div>
      )}
    </div>
  );
});
