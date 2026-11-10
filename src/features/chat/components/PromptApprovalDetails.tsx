import { promptOf } from "@/features/tools/lib/mcpAgent";
import type { ToolApproval } from "@/shared/types/elicitation";
import { requestValueClass } from "./RequestCard";

export function PromptApprovalDetails({ tool, input }: ToolApproval) {
  return (
    <>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {tool} receives only this prompt. Sharing more from your conversation or files needs another approval.
      </p>
      <blockquote
        tabIndex={0}
        aria-label={`Prompt shared with ${tool}`}
        className={`${requestValueClass} border-l-2 border-neutral-200 pl-3 dark:border-neutral-700`}
      >
        {promptOf(input)}
      </blockquote>
    </>
  );
}
