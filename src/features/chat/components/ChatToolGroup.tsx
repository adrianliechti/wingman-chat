import { ToolCase } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { UIMessage } from "@tanstack/ai";
import { subagentToolCallIds, summarizeToolGroup, toolRounds } from "./chatMessageUtils";
import { ActivityRow } from "./ActivityRow";
import { ChatToolMessage } from "./ChatToolMessage";
import { ChatMessageAttachments } from "./ChatMessageAttachments";
import { hasStoredAttachments } from "../lib/chatAttachments";

type ChatToolGroupProps = {
  messages: UIMessage[];
  indices: number[];
};

/** Every tool round of one message as nested rows. */
function ToolRows({ message, index, messages }: { message: UIMessage; index: number; messages: UIMessage[] }) {
  const delegated = subagentToolCallIds(messages);
  return (
    <>
      {toolRounds(message, delegated).map(({ call, result }) => (
        // Key by the stable tool-call id, not the array index — stop/restart
        // shifts indices, and index keys would reconcile the wrong rows.
        <ChatToolMessage key={call.id} message={message} call={call} result={result} index={index} nested />
      ))}
    </>
  );
}

/**
 * Folds a run of consecutive tool rounds into a single collapsible "Used N
 * tools" row. Expanding reveals the individual ChatToolMessage rows, each still
 * independently expandable.
 *
 * Stays collapsed by default — and never auto-expands/collapses — so the layout
 * height doesn't change as a turn finishes (that shift fought the scroll hold
 * and made the viewport jump). Live progress is shown by the running tool row
 * and the activity dots instead.
 */
export const ChatToolGroup = memo(function ChatToolGroup({ messages, indices }: ChatToolGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeToolGroup(messages, indices), [messages, indices]);

  return (
    <div className="pb-2 max-w-full">
      <ActivityRow
        label={summary}
        icon={ToolCase}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />

      {expanded && (
        <div className="mt-1 ml-4.5">
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
        </div>
      )}
    </div>
  );
});
