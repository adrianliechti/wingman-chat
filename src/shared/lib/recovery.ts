/**
 * Recovery helpers for Responses API history.
 *
 * The client uses `store: false`, so each request must carry a self-consistent
 * input. The invariant most likely to break is an interrupted turn:
 * a `function_call` without its paired `function_call_output` (cancelled
 * mid-tool), or vice versa from corrupted history. We drop those orphans
 * before sending.
 *
 * Replayed reasoning items have their own invariant: each must be followed by
 * the assistant output it produced, so one stranded by orphan removal (or by
 * an interrupted stream) is dropped as well.
 */

import type { ResponseInputItem } from "openai/resources/responses/responses";

/**
 * Drop unpaired tool-call/output items from a prepared Responses input batch.
 * Operates at item granularity so a turn with a mix of valid and orphaned
 * pairs only loses the orphaned ones.
 */
export function dropOrphanFunctionCalls(items: ResponseInputItem[]): ResponseInputItem[] {
  const pending = new Map<string, number>();
  const seen = new Set<string>();
  const keep = new Set<number>();
  for (const [index, item] of items.entries()) {
    if (item.type === "function_call") {
      if (item.call_id && !seen.has(item.call_id)) {
        seen.add(item.call_id);
        pending.set(item.call_id, index);
      }
    } else if (item.type === "function_call_output") {
      const call = item.call_id ? pending.get(item.call_id) : undefined;
      if (call !== undefined) {
        keep.add(call);
        keep.add(index);
        pending.delete(item.call_id!);
      }
    } else {
      keep.add(index);
    }
  }
  return items.filter((_, index) => keep.has(index));
}

/**
 * Keep a reasoning item only when the assistant output it produced (a message
 * or function call) still follows it, possibly after further reasoning items.
 * Providers reject a replayed reasoning item without its following item.
 */
export function dropDanglingReasoning(items: ResponseInputItem[]): ResponseInputItem[] {
  const kept: ResponseInputItem[] = [];
  let followedByOutput = false;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.type === "reasoning") {
      if (followedByOutput) kept.push(item);
      continue;
    }
    followedByOutput = item.type === "function_call" || (item.type === "message" && item.role === "assistant");
    kept.push(item);
  }
  return kept.reverse();
}
