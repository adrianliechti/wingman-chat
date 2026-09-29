import type { ChatInterrupt, ToolApprovalInterrupt } from "@tanstack/ai-client";
import { useChatRunState } from "../hooks/useChat";
import { ChatMessageElicitation } from "./ChatMessageElicitation";
import type { FormElicitation } from "@/shared/types/elicitation";

/** The framework owns batching, validation, cancellation and resume. */
export function ChatInterrupts() {
  const { interruptState } = useChatRunState();
  if (!interruptState?.interrupts.length) return null;
  return (
    <div
      className="mb-3 max-h-[50vh] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
      aria-label="Agent requests"
    >
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
        <p className="text-sm" role="status">
          Continuing…
        </p>
      )}
    </div>
  );
}

function InterruptRequest({ interrupt }: { interrupt: ChatInterrupt | ToolApprovalInterrupt }) {
  if (interrupt.kind === "tool-approval") {
    return (
      <>
        <p className="mb-2 text-sm">{interrupt.message ?? `Allow ${interrupt.toolName}?`}</p>
        <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(interrupt.originalArgs, null, 2)}
        </pre>
        <button type="button" className="btn btn-sm mr-2" onClick={() => interrupt.resolveInterrupt(true)}>
          Approve
        </button>
        <button type="button" className="btn btn-sm" onClick={() => interrupt.resolveInterrupt(false)}>
          Decline
        </button>
      </>
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
      <p className="mb-2 text-sm">{interrupt.message ?? "The agent is waiting for input."}</p>
      {interrupt.kind !== "unbound" && (
        <button type="button" className="btn btn-sm" onClick={interrupt.cancel}>
          Cancel request
        </button>
      )}
    </>
  );
}
