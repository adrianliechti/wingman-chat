import { cn } from "@/shared/lib/cn";
import { inputLabel, inputValue } from "@/shared/lib/toolInput";
import type { ToolApproval } from "@/shared/types/elicitation";
import { PromptApprovalDetails } from "./PromptApprovalDetails";
import {
  primaryRequestButtonClass,
  quietRequestButtonClass,
  requestButtonClass,
  RequestCard,
  requestValueClass,
} from "./RequestCard";

/**
 * Shared by native chat approvals and direct MCP/voice confirmations. Only the
 * request itself (a URL, a query, instructions) is shown; the tool row keeps
 * the full input one click away.
 */
export function ApprovalRequest({
  approval,
  onApprove,
  onDecline,
  onCancel,
}: {
  approval: ToolApproval;
  onApprove: () => void;
  onDecline: () => void;
  onCancel?: () => void;
}) {
  const { input, primary = [] } = approval;
  const keys = Object.keys(input).filter((key) => input[key] !== undefined);
  const main = keys.filter((key) => primary.includes(key));
  // Without a recognisable request, every argument is the request.
  const shown = main.length ? main : keys;
  return (
    <RequestCard
      title={`Allow ${approval.tool}?`}
      source={approval.source}
      actions={
        <>
          <button type="button" className={primaryRequestButtonClass} onClick={onApprove}>
            Allow
          </button>
          <button
            type="button"
            className={requestButtonClass}
            onClick={onDecline}
            title="Decline this request and let the agent continue"
          >
            Decline
          </button>
          {onCancel && (
            <button
              type="button"
              className={quietRequestButtonClass}
              onClick={onCancel}
              title="Cancel this request without approving it"
            >
              Cancel
            </button>
          )}
        </>
      }
    >
      {approval.kind === "prompt" ? (
        <PromptApprovalDetails {...approval} />
      ) : (
        shown.length > 0 && (
          <div tabIndex={0} className={cn(requestValueClass, "space-y-1.5")}>
            {shown.map((key) => (
              <div key={key} className="min-w-0">
                {shown.length > 1 && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{inputLabel(key)}</p>
                )}
                <InputValue value={input[key]} />
              </div>
            ))}
          </div>
        )
      )}
    </RequestCard>
  );
}

function InputValue({ value }: { value: unknown }) {
  if (Array.isArray(value) && value.length > 1 && value.every((item) => typeof item === "string"))
    return (
      <ul className="list-disc pl-4 marker:text-neutral-400 dark:marker:text-neutral-600">
        {value.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    );
  return <p>{inputValue(Array.isArray(value) && value.length === 1 ? value[0] : value)}</p>;
}
