/** Advisory retrieval targets, keyed by the run's abort signal like the request caches. */
export const TOOL_CALL_TARGET = 20;
export const FETCH_CHAR_TARGET = 80_000;

export interface RunBudget {
  calls: number;
  fetchedChars: number;
  /** Evidence already shown in this run; distinct excerpts from one URL remain useful. */
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

/** Encourage synthesis as usage grows, without rejecting useful follow-up retrieval. */
export function efficiencyHint(budget: RunBudget): string {
  if (budget.calls < TOOL_CALL_TARGET - 4 && budget.fetchedChars < FETCH_CHAR_TARGET) return "";
  return `\n\n[Research has used ${budget.calls} tool calls and returned ${budget.fetchedChars} fetched characters. Prefer answering from the evidence gathered; retrieve more only to close an important remaining gap.]`;
}
