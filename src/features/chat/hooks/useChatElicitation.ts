import { useCallback, useEffect, useRef, useState } from "react";
import type { Elicitation, ElicitationResult, PendingElicitation } from "@/shared/types/elicitation";

/** Owns the pending promise, URL completion, and cancellation as one lifecycle. */
export function useChatElicitation() {
  const [pendingElicitation, setPending] = useState<PendingElicitation | null>(null);
  const pending = useRef<PendingElicitation | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const publish = useCallback((next: PendingElicitation | null) => {
    pending.current = next;
    setPending(next);
  }, []);
  const clearElicitation = useCallback(() => {
    clearTimeout(timer.current);
    pending.current?.resolve({ action: "cancel" });
    publish(null);
  }, [publish]);

  const requestElicitation = useCallback(
    (
      toolCallId: string,
      toolName: string,
      elicitation: Elicitation,
      signal?: AbortSignal,
    ): Promise<ElicitationResult> => {
      clearElicitation();
      if (signal?.aborted) return Promise.resolve({ action: "cancel" });
      return new Promise((resolve) => {
        const finish = (result: ElicitationResult) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const onAbort = () => {
          if (pending.current?.resolve === finish) clearElicitation();
          else finish({ action: "cancel" });
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        publish({ toolCallId, toolName, elicitation, resolve: finish });
      });
    },
    [clearElicitation, publish],
  );

  const resolveElicitation = useCallback(
    (result: ElicitationResult) => {
      const current = pending.current;
      if (!current) return;
      if (current.waiting) {
        clearElicitation();
        return;
      }
      if (current.elicitation.mode === "url" && result.action === "accept") {
        publish({ ...current, waiting: true });
        return;
      }
      current.resolve(result);
      publish(null);
    },
    [clearElicitation, publish],
  );

  const completeElicitation = useCallback(
    (id: string) => {
      const current = pending.current;
      if (!current?.waiting || current.elicitation.mode !== "url" || current.elicitation.elicitationId !== id) return;
      current.resolve({ action: "accept" });
      const completed = { ...current, waiting: false, completed: true };
      publish(completed);
      timer.current = setTimeout(() => {
        if (pending.current === completed) publish(null);
      }, 1500);
    },
    [publish],
  );

  useEffect(() => () => clearElicitation(), [clearElicitation]);
  return { pendingElicitation, requestElicitation, resolveElicitation, completeElicitation, clearElicitation };
}
