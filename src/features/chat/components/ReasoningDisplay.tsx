import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Markdown } from "@/shared/ui/Markdown";
import { cn } from "@/shared/lib/cn";
import { ActivityRow } from "./ActivityRow";

type ReasoningDisplayProps = {
  reasoning: string;
  isStreaming?: boolean;
};

const HEADING = /^(?:\*\*([^*\n]+)\*\*|#{1,6}\s+(.+?))\s*$/;

/**
 * Reasoning summaries open each step with a heading line ("**Checking sources**"
 * then a blank line). The latest one names the current step; a lone opening
 * heading moves out of the body so it isn't shown twice.
 */
export function reasoningHint(reasoning: string): { hint?: string; body: string } {
  const lines = reasoning.split("\n");
  const headings = lines.flatMap((line, index) => {
    const match = HEADING.exec(line.trim());
    const next = lines[index + 1];
    return match && (next === undefined || !next.trim()) ? [{ index, text: (match[1] ?? match[2]).trim() }] : [];
  });
  const last = headings.at(-1);
  if (!last) return { body: reasoning };
  const opening = lines.findIndex((line) => line.trim());
  const body =
    headings.length === 1 && last.index === opening
      ? lines
          .slice(last.index + 1)
          .join("\n")
          .trim()
      : reasoning;
  return { hint: last.text, body };
}

/** The current paragraph is the live preview; a new heading waits for its body. */
export function reasoningPreview(body: string): string {
  const latest =
    body
      .trim()
      .split(/\n\s*\n/)
      .at(-1) ?? "";
  return HEADING.test(latest.trim()) ? "" : latest;
}

/** The model's thinking as one collapsible activity row. */
export function ReasoningDisplay({ reasoning, isStreaming }: ReasoningDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  // Track the previous streaming state to detect transitions
  const [prevIsStreaming, setPrevIsStreaming] = useState(isStreaming);

  // Adjust state during render when isStreaming prop changes
  // This is React's recommended pattern for updating state based on props
  if (isStreaming !== prevIsStreaming) {
    setPrevIsStreaming(isStreaming);
    // Each new step starts with its preview; completed thoughts collapse.
    setIsExpanded(false);
  }

  const { hint, body } = reasoningHint(reasoning);
  const output = isExpanded ? body : isStreaming ? reasoningPreview(body) : "";

  // Show component if we have reasoning content OR if we're streaming (thinking in progress)
  if (!reasoning && !isStreaming) return null;

  return (
    <div>
      <ActivityRow
        label={isStreaming ? "Thinking…" : "Thought"}
        detail={hint}
        running={isStreaming}
        icon={Sparkles}
        expanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
      />
      {output && (
        <div
          role="region"
          aria-label={isExpanded ? "Thinking output" : "Thinking preview"}
          className={cn(
            "ml-4.5 pb-1 text-left text-xs text-neutral-500/80 [overflow-wrap:anywhere] [&_p]:leading-5 dark:text-neutral-400/80",
            !isExpanded && "line-clamp-3",
          )}
        >
          <Markdown compact isStreaming={isStreaming}>
            {output}
          </Markdown>
        </div>
      )}
    </div>
  );
}
