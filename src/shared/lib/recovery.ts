/**
 * Recovery helpers for Responses API history errors.
 *
 * The Responses API can reject inputs whose encrypted_content the current
 * model can't replay — reasoning items from a different model, stale
 * compaction tokens after a model swap, or items whose paired follow-up
 * lives only in server state. These errors can't be detected upfront, so
 * the caller catches them and retries once with the offending items
 * stripped from the input batch.
 *
 * Mirrors wingman-vscode/src/recovery.ts and openai-agents-python's
 * `drop_orphan_function_calls`.
 */

import { APIError } from "openai/error";
import type { ResponseInputItem } from "openai/resources/responses/responses";

function errorMessage(error: unknown): string {
  if (error instanceof APIError) {
    const body = error.error as { message?: string } | undefined;
    if (body?.message?.trim()) return body.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Match the shared "encrypted_content rejected" failure. The same error is
 * emitted for reasoning and compaction items, so the type-specific predicates
 * below both include this — the caller's retry order disambiguates.
 */
const ENCRYPTED_CONTENT_REJECTED =
  /encrypted[_ ]content.*(?:could not be|cannot be|failed to be)\s*(?:verified|decrypted|parsed|read|decoded)/i;

/**
 * Detect Responses API errors caused by a reasoning history the current
 * model cannot replay (encrypted_content from a different model, ZDR /
 * store:false, or a reasoning item whose required follow-up is missing).
 */
export function isReasoningHistoryError(error: unknown): boolean {
  const msg = errorMessage(error);
  return (
    ENCRYPTED_CONTENT_REJECTED.test(msg) ||
    /type ['"]reasoning['"].*provided without its required following item/i.test(msg)
  );
}

/**
 * Detect Responses API errors caused by a stale compaction item — compaction
 * encrypted_content the current model can't verify (model swap, key rotation,
 * or compaction tied to a since-expired conversation).
 */
export function isCompactionHistoryError(error: unknown): boolean {
  const msg = errorMessage(error);
  return ENCRYPTED_CONTENT_REJECTED.test(msg) || /type ['"]compaction['"].*provided without/i.test(msg);
}

/** Strip reasoning items from a prepared Responses input batch. */
export function stripReasoningItems(items: ResponseInputItem[]): ResponseInputItem[] {
  return items.filter((item) => item.type !== "reasoning");
}

/**
 * Strip compaction items from a prepared Responses input batch.
 * Compaction items are pushed with a structural cast (the SDK union doesn't
 * model them yet), so we read `type` defensively.
 */
export function stripCompactionItems(items: ResponseInputItem[]): ResponseInputItem[] {
  return items.filter((item) => (item as { type?: string }).type !== "compaction");
}

/**
 * Drop unpaired tool-call/output items from a prepared Responses input batch:
 *
 *   - `function_call` items without a matching `function_call_output`
 *     (interrupted tool execution, cancelled turn)
 *   - `function_call_output` items without a matching `function_call`
 *     (corrupted/partial history, message-level filtering dropping the
 *     calling assistant turn)
 *   - `reasoning` items left dangling because their paired call was just
 *     dropped — the Responses API rejects these with
 *     `provided without its required following item`.
 *
 * Operates at item granularity so a single turn with a mix of valid and
 * orphaned pairs only loses the orphaned ones. Mirrors openai-agents-python's
 * `drop_orphan_function_calls` (call direction) and replaces the all-or-nothing
 * message-level tool sanitization the chat client used to do.
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

  const droppedIndexes = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === "function_call") {
      if (typeof item.call_id === "string" && completedCallIds.has(item.call_id)) continue;
      droppedIndexes.add(i);
      continue;
    }
    if (item.type === "function_call_output") {
      if (typeof item.call_id === "string" && issuedCallIds.has(item.call_id)) continue;
      droppedIndexes.add(i);
    }
  }

  if (droppedIndexes.size === 0) return items;

  const droppedReasoning = new Set<number>();
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type !== "reasoning" || droppedIndexes.has(i)) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (droppedReasoning.has(j)) continue;
      if (items[j].type === "reasoning") continue;
      if (droppedIndexes.has(j)) droppedReasoning.add(i);
      break;
    }
  }

  const excluded = new Set<number>([...droppedIndexes, ...droppedReasoning]);
  return items.filter((_, i) => !excluded.has(i));
}
