import type { SubagentPart } from "@tanstack/ai";
import { Markdown } from "@/shared/ui/Markdown";

/** Native nested messages stay separate from the parent's answer. */
export function SubagentCard({ subagent }: SubagentPart) {
  return (
    <details
      open={subagent.status === "running" || subagent.status === "suspended"}
      className="my-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700"
    >
      <summary className="cursor-pointer text-sm font-medium">
        {subagent.name} · {subagent.status === "suspended" ? "Waiting for input" : subagent.status}
      </summary>
      <div className="mt-2 space-y-2 text-sm">
        {subagent.messages.map((message) => (
          <div key={message.id}>
            {message.parts.map((part, index) => {
              if (part.type === "text")
                return (
                  <Markdown key={index} isStreaming={subagent.status === "running"}>
                    {part.content}
                  </Markdown>
                );
              if (part.type === "tool-call")
                return (
                  <p key={part.id} className="text-xs text-neutral-500">
                    {part.name} · {part.state}
                  </p>
                );
              if (part.type === "subagent") return <SubagentCard key={part.subagent.id} {...part} />;
              return null;
            })}
          </div>
        ))}
        {subagent.error && (
          <p role="alert" className="text-red-600">
            {subagent.error.message}
          </p>
        )}
      </div>
    </details>
  );
}
