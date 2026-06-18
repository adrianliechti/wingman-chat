import { ChevronRight, ToolCase } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/shared/lib/cn";
import type { Message } from "@/shared/types/chat";
import { ChatToolMessage } from "./ChatToolMessage";

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

  return (
    <div className="pb-2 max-w-full">
      <button onClick={() => setExpanded((v) => !v)} className="w-full text-left transition-colors" type="button">
        <div className="grid grid-cols-[12px_minmax(0,1fr)] items-center gap-1.5 min-w-0">
          <ChevronRight
            className={cn(
              "w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0 transition-transform",
              expanded && "rotate-90",
            )}
          />
          <div className="flex items-center gap-2 min-w-0">
            <ToolCase className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0" />
            <span className="text-xs font-medium whitespace-nowrap text-neutral-500 dark:text-neutral-400">
              Used {indices.length} tools
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-1">
          {indices.map((idx) => (
            <ChatToolMessage key={idx} message={messages[idx]} index={idx} />
          ))}
        </div>
      )}
    </div>
  );
});
