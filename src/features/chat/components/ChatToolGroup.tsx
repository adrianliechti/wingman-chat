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
  return (
    <>
      {message.parts.map((part, partIndex) =>
        part.type === "thinking" && part.content ? <ReasoningDisplay key={partIndex} reasoning={part.content} /> : null,
      )}
      {toolRounds(message, delegated).map(({ call, result }) => (
        // Key by the stable tool-call id, not the array index — stop/restart
        // shifts indices, and index keys would reconcile the wrong rows.
        <ChatToolMessage key={call.id} message={message} call={call} result={result} index={index} />
      ))}
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
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />

      {/* Unfolded rows keep the group's vertical line rather than nesting a level deeper. */}
      {expanded && (
        <div>
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
