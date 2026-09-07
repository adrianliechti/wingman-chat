import { useCallback, useRef, useState } from "react";
import type { QueuedSend } from "../lib/chatQueue";

export function useChatQueue() {
  const [queuedSends, setQueuedSends] = useState<QueuedSend[]>([]);
  const queuedSendsRef = useRef<QueuedSend[]>([]);
  const replaceQueue = useCallback((update: (items: QueuedSend[]) => QueuedSend[]) => {
    const next = update(queuedSendsRef.current);
    queuedSendsRef.current = next;
    setQueuedSends(next);
    return next;
  }, []);
  const holdQueuedSends = useCallback(
    (targetChatId: string) => {
      replaceQueue((items) =>
        items.map((item) =>
          item.chatId === targetChatId && item.status === "queued" ? { ...item, status: "held" } : item,
        ),
      );
    },
    [replaceQueue],
  );

  const takeQueuedSends = useCallback(
    (targetChatId: string): QueuedSend[] => {
      const ready = queuedSendsRef.current.filter((item) => item.chatId === targetChatId && item.status === "queued");
      if (ready.length > 0) {
        replaceQueue((items) => items.filter((item) => !ready.some((queued) => queued.id === item.id)));
      }
      return ready;
    },
    [replaceQueue],
  );

  const removeQueuedMessage = useCallback(
    (id: string) => {
      replaceQueue((items) => items.filter((item) => item.id !== id));
    },
    [replaceQueue],
  );

  return { queuedSends, queuedSendsRef, replaceQueue, holdQueuedSends, takeQueuedSends, removeQueuedMessage };
}
