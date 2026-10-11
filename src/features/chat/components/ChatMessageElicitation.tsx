import { Check, CheckCircle2, ExternalLink, Loader2, ShieldQuestion, X } from "lucide-react";
import { ElicitationForm } from "./ElicitationForm";
import { getToolDisplayName } from "@/shared/lib/utils";
import { Markdown } from "@/shared/ui/Markdown";

import type { Elicitation, ElicitationResult, FormElicitation, UrlElicitation } from "@/shared/types/elicitation";

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

  return <FormElicitationView toolName={toolName} elicitation={elicitation} onResolve={onResolve} />;
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
  const handleOpen = () => {
    window.open(elicitation.url, "_blank", "noopener,noreferrer");
    onResolve({ action: "accept" });
  };

  const renderActions = () => {
    if (completed) {
      return (
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 text-green-500 dark:text-green-400" />
          <span className="text-xs text-green-600 dark:text-green-400">Completed</span>
        </div>
      );
    }

    if (waiting) {
      return (
        <div className="flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin text-neutral-400 dark:text-neutral-500" />
          <span className="text-xs text-neutral-500 dark:text-neutral-400">Waiting for completion…</span>
          <button
            type="button"
            onClick={() => onResolve({ action: "cancel" })}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleOpen}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Open URL
        </button>
        <button
          type="button"
          onClick={() => onResolve({ action: "decline" })}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
        >
          <X className="w-3 h-3" />
          Decline
        </button>
        <button
          type="button"
          onClick={() => onResolve({ action: "cancel" })}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  };

  return (
    <div className="rounded-lg overflow-hidden max-w-full">
      <div className="flex items-start gap-2 min-w-0">
        <ShieldQuestion className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {getToolDisplayName(toolName)}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            <Markdown compact>{elicitation.message}</Markdown>
          </div>
          <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-200 break-all">
            {elicitation.url}
          </div>
          {renderActions()}
        </div>
      </div>
    </div>
  );
}

function FormElicitationView({
  toolName,
  elicitation,
  onResolve,
}: {
  toolName: string;
  elicitation: FormElicitation;
  onResolve: (result: ElicitationResult) => void;
}) {
  const requestedSchema = elicitation.requestedSchema;
  const isMinimalConfirmation = !requestedSchema || Object.keys(requestedSchema.properties).length === 0;
  if (isMinimalConfirmation) {
    return (
      <div className="rounded-lg overflow-hidden max-w-full">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldQuestion className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              <Markdown compact>{elicitation.message}</Markdown>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onResolve({ action: "accept", content: {} })}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
              >
                <Check className="w-3 h-3" />
                Approve
              </button>
              <button
                type="button"
                onClick={() => onResolve({ action: "decline" })}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
              >
                <X className="w-3 h-3" />
                Decline
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <ElicitationForm toolName={toolName} elicitation={elicitation} onResolve={onResolve} />;
}
