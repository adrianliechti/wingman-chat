import { ToolCase } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { Message } from "@/shared/types/chat";
import { summarizeToolGroup } from "./chatMessageUtils";
import { ActivityRow } from "./ActivityRow";
import { ChatToolMessage } from "./ChatToolMessage";
import { ChatMessageAttachments } from "./ChatMessageAttachments";
import { hasStoredAttachments } from "../lib/chatAttachments";

type ChatToolGroupProps = {
  messages: Message[];
  indices: number[];
};

/**
 * Folds a run of consecutive tool results into a single collapsible "Used N
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
            const result = messages[idx].content.find((p) => p.type === "tool_result");
            // Key by the stable tool-call id, not the array index — stop/restart
            // shifts indices, and index keys would reconcile the wrong rows.
            const key = result && "id" in result ? result.id : idx;
            return hasStoredAttachments(messages[idx].content) ? (
              <ChatMessageAttachments key={key} message={messages[idx]}>
                {(message) => <ChatToolMessage message={message} index={idx} nested />}
              </ChatMessageAttachments>
            ) : (
              <ChatToolMessage key={key} message={messages[idx]} index={idx} nested />
            );
          })}
        </div>
      )}
    </div>
  );
});
