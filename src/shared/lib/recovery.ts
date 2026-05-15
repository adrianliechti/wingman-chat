/**
 * Recovery helpers for Responses API history.
 *
 * The client uses `store: false`, so each request must carry a self-consistent
 * input. The invariant most likely to break is an interrupted turn:
 * a `function_call` without its paired `function_call_output` (cancelled
 * mid-tool), or vice versa from corrupted history. We drop those orphans
 * before sending.
 *
 * Reasoning items are never added to the input (see the assistant-role
 * branch in `client.ts`), so no recovery is needed for them.
 */

import type { ResponseInputItem } from "openai/resources/responses/responses";

/**
 * Drop unpaired tool-call/output items from a prepared Responses input batch.
 * Operates at item granularity so a turn with a mix of valid and orphaned
 * pairs only loses the orphaned ones.
 */
export function dropOrphanFunctionCalls(items: ResponseInputItem[]): ResponseInputItem[] {
  const outputs = new Set<string>();
  const calls = new Set<string>();
  for (const item of items) {
    if (item.type === "function_call_output") outputs.add(item.call_id);
    else if (item.type === "function_call") calls.add(item.call_id);
  }

  return items.filter((item) => {
    if (item.type === "function_call") return outputs.has(item.call_id);
    if (item.type === "function_call_output") return calls.has(item.call_id);
    return true;
  });
}
