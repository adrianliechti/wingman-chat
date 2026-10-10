/** Per-run retrieval budget, keyed by the run's abort signal like the request caches. */
export const MAX_TOOL_CALLS = 20;
export const MAX_TOTAL_FETCH_CHARS = 80_000;

export const BUDGET_EXHAUSTED =
  "Error: tool-call budget exhausted; this call was not executed. Write the final answer now using only the evidence already gathered, with a URL for each claim, and state exactly what is missing.";
export const FETCH_BUDGET_EXHAUSTED =
  "Error: total fetch budget exhausted; use the evidence already gathered and state any gaps.";

export interface RunBudget {
  calls: number;
  fetchedChars: number;
  /** Canonical URLs already shown in this run, so later searches list them once. */
  seen: Set<string>;
}

const scopes = new WeakMap<AbortSignal, RunBudget>();

/** Without a run signal every call gets a fresh budget, i.e. no tracking. */
export function runBudget(signal?: AbortSignal): RunBudget {
  const fresh = (): RunBudget => ({ calls: 0, fetchedChars: 0, seen: new Set() });
  if (!signal) return fresh();
  let budget = scopes.get(signal);
  if (!budget) {
    budget = fresh();
    scopes.set(signal, budget);
  }
  return budget;
}

/** Reserve one tool call; the message to return instead when the ceiling is reached. */
export function takeCall(budget: RunBudget): string | undefined {
  if (budget.calls >= MAX_TOOL_CALLS) return BUDGET_EXHAUSTED;
  budget.calls++;
  return undefined;
}

/** A closing hint once few calls remain, appended to tool output like the gateway agent does. */
export function remainingHint(budget: RunBudget): string {
  const remaining = MAX_TOOL_CALLS - budget.calls;
  if (remaining <= 0 || remaining > Math.max(2, Math.floor(MAX_TOOL_CALLS / 5))) return "";
  return `\n\n[${remaining} tool call${remaining === 1 ? "" : "s"} remaining — close the most important gap, then answer]`;
}
