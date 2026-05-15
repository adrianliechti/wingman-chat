/**
 * Recovery helpers for Responses API history.
 *
 * The client uses `store: false`, so each request must carry a self-consistent
 * input. The most common way that invariant breaks is an interrupted turn:
 * a `function_call` item left in history without its paired
 * `function_call_output` (cancelled mid-tool), or vice versa from corrupted
 * history. We drop those orphans before sending.
 *
 * Reasoning items are never added to the input in the first place (see the
 * assistant-role branch in `client.ts`), so no recovery is needed for them.
 */

import type { ResponseInputItem } from "openai/resources/responses/responses";

/**
 * Drop unpaired tool-call/output items from a prepared Responses input batch:
 *
 *   - `function_call` without a matching `function_call_output`
 *     (interrupted tool execution, cancelled turn)
 *   - `function_call_output` without a matching `function_call`
 *     (corrupted/partial history, message-level filtering that dropped the
 *     calling assistant turn)
 *
 * Operates at item granularity so a turn with a mix of valid and orphaned
 * pairs only loses the orphaned ones.
 */
export function dropOrphanFunctionCalls(items: ResponseInputItem[]): ResponseInputItem[] {
  const completedCallIds = new Set<string>();
  const issuedCallIds = new Set<string>();
  for (const item of items) {
    if (item.type === "function_call_output" && typeof item.call_id === "string") {
      completedCallIds.add(item.call_id);
    }
    if (item.type === "function_call" && typeof item.call_id === "string") {
      issuedCallIds.add(item.call_id);
    }
  }

  return items.filter((item) => {
    if (item.type === "function_call") {
      return typeof item.call_id === "string" && completedCallIds.has(item.call_id);
    }
    if (item.type === "function_call_output") {
      return typeof item.call_id === "string" && issuedCallIds.has(item.call_id);
    }
    return true;
  });
}
