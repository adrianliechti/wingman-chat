import { BatchStrategy, CompositeStrategy, PunctuationStrategy, WordBoundaryStrategy } from "@tanstack/ai";

/** Opt in to TanStack's native diagnostic categories during local development. */
export const aiDebug = import.meta.env.DEV && import.meta.env.VITE_AI_DEBUG === "true" ? true : undefined;

/** Fresh state per stream; TanStack flushes remaining text at message boundaries. */
export function textStreamStrategy() {
  return new CompositeStrategy([new BatchStrategy(3), new WordBoundaryStrategy(), new PunctuationStrategy()]);
}
