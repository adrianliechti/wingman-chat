import { EventType, type AGUIEvent } from "@ag-ui/core";

/** Opt in to TanStack's native diagnostic categories during local development. */
export const aiDebug = import.meta.env.DEV && import.meta.env.VITE_AI_DEBUG === "true" ? true : undefined;

/** A tool turn closes one model call; its metadata must reach clients before the next call. */
export function isIntermediateToolTurn(chunk: AGUIEvent): boolean {
  if (chunk.type !== EventType.RUN_FINISHED || chunk.outcome?.type === "interrupt") return false;
  const tanstack = chunk.metadata?.tanstack as { finishReason?: string } | undefined;
  return tanstack?.finishReason === "tool_calls";
}
