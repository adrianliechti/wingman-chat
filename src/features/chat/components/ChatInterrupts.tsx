import type { ChatInterrupt, ToolApprovalInterrupt } from "@tanstack/ai-client";
import { Check, ChevronRight, ShieldQuestion, X } from "lucide-react";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { useChatRunState } from "../hooks/useChat";
import { ChatMessageElicitation } from "./ChatMessageElicitation";
import type { FormElicitation } from "@/shared/types/elicitation";
import { findTool, resolveToolHeader } from "./toolDisplay";

/** The framework owns batching, validation, cancellation and resume. */
export function ChatInterrupts() {
  const { interruptState } = useChatRunState();
  if (!interruptState?.interrupts.length) return null;
  return (
    <div className="my-2 pb-2 text-xs text-neutral-500 dark:text-neutral-400" aria-label="Agent requests">
      {interruptState.interrupts.map((interrupt) => (
        <fieldset
          key={interrupt.id}
          disabled={
            interruptState.resuming ||
            interrupt.status === "submitting" ||
            interrupt.status === "staged" ||
            !interrupt.canResolve
          }
          className="mb-3 last:mb-0 disabled:opacity-60"
        >
          <InterruptRequest interrupt={interrupt} />
          {interrupt.errors.map((error, index) => (
            <p key={index} role="alert" className="text-sm text-red-600">
              {error.message}
            </p>
          ))}
        </fieldset>
      ))}
      {interruptState.interruptErrors.map((error, index) => (
        <p key={index} role="alert" className="text-sm text-red-600">
          {error.message}
        </p>
      ))}
      {interruptState.resuming && (
        <p className="text-xs" role="status">
          Continuing…
        </p>
      )}
    </div>
  );
}

function InterruptRequest({ interrupt }: { interrupt: ChatInterrupt | ToolApprovalInterrupt }) {
  const { providers } = useToolsContext();
  if (interrupt.kind === "tool-approval") {
    const args = JSON.stringify(interrupt.originalArgs, null, 2);
    const tool = findTool(providers, interrupt.toolName);
    const header = resolveToolHeader(tool, interrupt.toolName, args, {});
    const input = interrupt.originalArgs;
    const brief =
      tool?.subagent && input && typeof input === "object" && "prompt" in input && typeof input.prompt === "string"
        ? input.prompt
        : undefined;
    return (
      <div className="flex min-w-0 items-start gap-2">
        <ShieldQuestion aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-neutral-400 dark:text-neutral-500" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium">
            {interrupt.message?.replace(`run ${interrupt.toolName}`, `run ${header.label}`) ?? `Allow ${header.label}?`}
          </p>
          {header.preview && <p className="line-clamp-2 break-words">{header.preview}</p>}
          {args && args !== "{}" && (
            <details className="group/args">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden="true" className="size-3 transition-transform group-open/args:rotate-90" />
                View details
              </summary>
              {brief ? (
                <p className="mt-1 whitespace-pre-wrap break-words">{brief}</p>
              ) : (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{args}</pre>
              )}
            </details>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded bg-neutral-200 px-2 py-1 text-xs font-medium text-neutral-800 transition-colors hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              onClick={() => interrupt.resolveInterrupt(true)}
            >
              <Check aria-hidden="true" className="size-3" /> Approve
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:text-neutral-800 dark:hover:text-neutral-200"
              onClick={() => interrupt.resolveInterrupt(false)}
            >
              <X aria-hidden="true" className="size-3" /> Decline
            </button>
          </div>
        </div>
      </div>
    );
  }
  const payload = interrupt.metadata?.["tanstack:interruptPayload"] as
    | { kind?: string; request?: FormElicitation }
    | undefined;
  if (interrupt.kind === "generic" && payload?.kind === "form" && payload.request?.requestedSchema) {
    return (
      <ChatMessageElicitation
        toolName={typeof interrupt.metadata?.toolName === "string" ? interrupt.metadata.toolName : "Question"}
        elicitation={payload.request}
        onResolve={(result) => (result.action === "cancel" ? interrupt.cancel() : interrupt.resolveInterrupt(result))}
      />
    );
  }
  return (
    <>
      <p className="mb-2">{interrupt.message ?? "The agent is waiting for input."}</p>
      {interrupt.kind !== "unbound" && (
        <button
          type="button"
          className="rounded px-2 py-1 text-xs transition-colors hover:text-neutral-800 dark:hover:text-neutral-200"
          onClick={interrupt.cancel}
        >
          Cancel request
        </button>
      )}
    </>
  );
}
