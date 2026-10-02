import { useMemo } from "react";
import { ChatInterrupts } from "@/features/chat/components/ChatInterrupts";
import { ChatMessage } from "@/features/chat/components/ChatMessage";
import { ChatToolGroup } from "@/features/chat/components/ChatToolGroup";
import { groupRenderUnits, isToolResultMessage } from "@/features/chat/components/chatMessageUtils";
import { useChat } from "@/features/chat/hooks/useChat";

/** The current chat's messages, with runs of tool results folded into groups. */
export function ChatMessageList({ scope }: { scope: string }) {
  const { messages, isResponding, pendingElicitation } = useChat();

  // Persisted IDs survive streaming, edits and reloads. Scope legacy fallbacks
  // to the chat without mutating refs during a potentially interrupted render.
  const messageRenderKeys = messages.map((message, index) => `${scope}:${message.id ?? index}`);

  // Fold runs of consecutive tool results into collapsible groups so tool-heavy
  // turns read as one tidy "Used N tools" row instead of a scattered stack.
  const renderUnits = useMemo(
    () => groupRenderUnits(messages, isResponding, pendingElicitation?.toolCallId ?? null),
    [messages, isResponding, pendingElicitation?.toolCallId],
  );

  return (
    <div>
      {renderUnits.map((unit) => {
        if (unit.kind === "toolGroup") {
          // Key off the first tool-call id — stable as the group grows and across restarts.
          const first = messages[unit.indices[0]].content.find((p) => p.type === "tool_result");
          const groupKey = first && "id" in first ? `group:${first.id}` : `group:${messageRenderKeys[unit.indices[0]]}`;
          return (
            <div key={groupKey} className="flow-root" data-role="tool-group">
              <ChatToolGroup messages={messages} indices={unit.indices} />
            </div>
          );
        }
        const index = unit.index;
        const message = messages[index];
        // Tool results are role "user" too; tag them so the scroll pin anchors to prompts.
        const dataRole = isToolResultMessage(message) ? "tool" : message.role;
        return (
          <div key={messageRenderKeys[index]} className="flow-root" data-role={dataRole}>
            <ChatMessage
              index={index}
              message={message}
              isLast={index === messages.length - 1}
              isResponding={isResponding}
            />
          </div>
        );
      })}
      <ChatInterrupts />
    </div>
  );
}
