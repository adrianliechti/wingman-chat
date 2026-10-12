import { convertSchemaToJsonSchema, type SchemaInput } from "@tanstack/ai";
import type { ChatInterrupt, ToolApprovalInterrupt } from "@tanstack/ai-client";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { useChatRunState } from "../hooks/useChat";
import { ChatMessageElicitation } from "./ChatMessageElicitation";
import { ApprovalRequest } from "./ApprovalRequest";
import type { FormElicitation } from "@/shared/types/elicitation";
import { primaryInputKeys } from "@/shared/lib/toolInput";
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
    const tool = findTool(providers, interrupt.toolName);
    const header = resolveToolHeader(tool, interrupt.toolName, JSON.stringify(interrupt.originalArgs), {});
    const original =
      interrupt.originalArgs && typeof interrupt.originalArgs === "object" && !Array.isArray(interrupt.originalArgs)
        ? (interrupt.originalArgs as Record<string, unknown>)
        : { input: interrupt.originalArgs };
    // A subagent receives its brief rather than the raw prompt, so that is what is approved.
    const brief =
      tool?.subagent?.brief && typeof original.prompt === "string" ? tool.subagent.brief(original) : undefined;
    const input = brief ? { ...original, prompt: brief } : original;
    const provider = providers.find((provider) => tool && provider.tools.includes(tool));
    return (
      <ApprovalRequest
        approval={{
          tool: header.label,
          source: provider && provider.name !== header.label ? provider.name : undefined,
          input,
          primary: primaryInputKeys(input, tool && jsonSchema(tool.inputSchema)),
        }}
        onApprove={() => interrupt.resolveInterrupt(true)}
        onDecline={() => interrupt.resolveInterrupt(false)}
        onCancel={() => interrupt.cancel()}
      />
    );
  }
  const payload = interrupt.metadata?.["tanstack:interruptPayload"] as
    | { kind?: string; request?: FormElicitation }
    | undefined;
  if (interrupt.kind === "generic" && payload?.kind === "form" && payload.request) {
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

function jsonSchema(schema: SchemaInput): unknown {
  try {
    return convertSchemaToJsonSchema(schema);
  } catch {
    return undefined;
  }
}
