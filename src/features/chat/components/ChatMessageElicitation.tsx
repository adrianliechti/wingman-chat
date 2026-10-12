import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { ElicitationForm } from "./ElicitationForm";
import { ApprovalRequest } from "./ApprovalRequest";
import {
  primaryRequestButtonClass,
  quietRequestButtonClass,
  requestButtonClass,
  RequestCard,
  requestValueClass,
} from "./RequestCard";
import { getToolDisplayName } from "@/shared/lib/utils";
import { cn } from "@/shared/lib/cn";
import { Markdown } from "@/shared/ui/Markdown";
import type { Elicitation, ElicitationResult, UrlElicitation } from "@/shared/types/elicitation";

type ChatMessageElicitationProps = {
  toolName: string;
  elicitation: Elicitation;
  waiting?: boolean;
  completed?: boolean;
  onResolve: (result: ElicitationResult) => void;
};

export function ChatMessageElicitation({
  toolName,
  elicitation,
  waiting,
  completed,
  onResolve,
}: ChatMessageElicitationProps) {
  if (elicitation.mode === "url") {
    return (
      <UrlElicitationView
        toolName={toolName}
        elicitation={elicitation}
        waiting={waiting}
        completed={completed}
        onResolve={onResolve}
      />
    );
  }
  if (elicitation.requestedSchema && Object.keys(elicitation.requestedSchema.properties).length > 0) {
    return <ElicitationForm toolName={toolName} elicitation={elicitation} onResolve={onResolve} />;
  }
  if (elicitation.approval) {
    return (
      <ApprovalRequest
        approval={elicitation.approval}
        onApprove={() => onResolve({ action: "accept", content: {} })}
        onDecline={() => onResolve({ action: "decline" })}
        onCancel={() => onResolve({ action: "cancel" })}
      />
    );
  }
  return (
    <RequestCard
      title="Allow this request?"
      source={elicitation.source ?? getToolDisplayName(toolName)}
      actions={
        <>
          <button
            type="button"
            onClick={() => onResolve({ action: "accept", content: {} })}
            className={primaryRequestButtonClass}
          >
            Allow
          </button>
          <button type="button" onClick={() => onResolve({ action: "decline" })} className={requestButtonClass}>
            Decline
          </button>
          <button
            type="button"
            onClick={() => onResolve({ action: "cancel" })}
            className={quietRequestButtonClass}
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="break-words [overflow-wrap:anywhere]">
        <Markdown compact>{elicitation.message}</Markdown>
      </div>
    </RequestCard>
  );
}

function UrlElicitationView({
  toolName,
  elicitation,
  waiting,
  completed,
  onResolve,
}: {
  toolName: string;
  elicitation: UrlElicitation;
  waiting?: boolean;
  completed?: boolean;
  onResolve: (result: ElicitationResult) => void;
}) {
  return (
    <RequestCard
      title={completed ? "Request completed" : waiting ? "Finish in your browser" : "Continue in your browser"}
      source={elicitation.source ?? getToolDisplayName(toolName)}
      icon={completed ? CheckCircle2 : undefined}
      completed={completed}
      actions={
        completed ? (
          <p role="status" className="text-xs text-neutral-500 dark:text-neutral-400">
            You’re all set. Continuing…
          </p>
        ) : (
          <>
            <a
              href={elicitation.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(waiting ? requestButtonClass : primaryRequestButtonClass, "inline-flex items-center gap-1")}
              onClick={() => {
                if (!waiting) onResolve({ action: "accept" });
              }}
            >
              {waiting ? "Open again" : "Open page"}
              <ExternalLink aria-hidden="true" className="size-3" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            {!waiting && (
              <button type="button" onClick={() => onResolve({ action: "decline" })} className={requestButtonClass}>
                Decline
              </button>
            )}
            <button
              type="button"
              onClick={() => onResolve({ action: "cancel" })}
              className={quietRequestButtonClass}
            >
              Cancel
            </button>
          </>
        )
      }
    >
      {elicitation.message && (
        <div className="break-words [overflow-wrap:anywhere]">
          <Markdown compact>{elicitation.message}</Markdown>
        </div>
      )}
      <p className={cn(requestValueClass, "break-all")}>{elicitation.url}</p>
      {!completed && (
        <p role="status" className="flex items-start gap-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          {waiting && (
            <Loader2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          )}
          {waiting
            ? "Complete the steps in the other tab. This updates automatically when you’re done."
            : "Opens in a new tab. Come back here when you’re done."}
        </p>
      )}
    </RequestCard>
  );
}
