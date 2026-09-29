import { ChevronRight, Loader2 } from "lucide-react";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import type { SubagentContent } from "@/shared/types/chat";
import { Markdown } from "@/shared/ui/Markdown";
import { ActivityRow } from "./ActivityRow";
import { ChatToolMessage } from "./ChatToolMessage";
import { findTool, resolveToolHeader } from "./toolDisplay";
import { subagentToolCallIds } from "./chatMessageUtils";

/** Child activity uses the same quiet disclosure and tool rows as chat. */
export function SubagentCard({ name, status, messages, error }: SubagentContent) {
  const { providers } = useToolsContext();
  const running = status === "running";
  const header = resolveToolHeader(findTool(providers, name), name, undefined, { running });
  const delegated = subagentToolCallIds(messages);
  const answered = new Set(
    messages.flatMap((message) => message.content.flatMap((part) => (part.type === "tool_result" ? [part.id] : []))),
  );
  return (
    <details open={running || status === "suspended"} className="group/subagent my-1 min-w-0">
      <summary className="grid cursor-pointer list-none grid-cols-[12px_minmax(0,1fr)] items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="size-3 transition-transform group-open/subagent:rotate-90" />
        <span className="flex min-w-0 items-center gap-2">
          {running && <Loader2 aria-hidden="true" className="size-3 shrink-0 animate-spin" />}
          <span className="truncate font-medium">{header.label}</span>
          {status === "suspended" && <span>Waiting for input</span>}
          {status === "error" && <span>Failed</span>}
        </span>
      </summary>
      <div className="mt-2 ml-4.5 space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
        {messages.map((message, messageIndex) => (
          <div key={message.id ?? messageIndex}>
            {message.content.some(
              (part) => part.type === "tool_result" && (!delegated.has(part.id) || message.error),
            ) && <ChatToolMessage message={message} index={messageIndex} messages={messages} nested />}
            {message.content.map((part, index) => {
              if (part.type === "text" && message.role === "assistant")
                return (
                  <Markdown key={index} compact isStreaming={running}>
                    {part.text}
                  </Markdown>
                );
              if (part.type === "tool_call" && !answered.has(part.id) && !delegated.has(part.id)) {
                const tool = resolveToolHeader(findTool(providers, part.name), part.name, part.arguments, { running });
                return (
                  <ActivityRow
                    key={part.id}
                    running={running}
                    label={tool.label}
                    detail={tool.preview}
                    mono={tool.mono}
                    className="pb-1"
                  />
                );
              }
              if (part.type === "subagent") return <SubagentCard key={part.id} {...part} />;
              return null;
            })}
          </div>
        ))}
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error.message}
          </p>
        )}
      </div>
    </details>
  );
}
