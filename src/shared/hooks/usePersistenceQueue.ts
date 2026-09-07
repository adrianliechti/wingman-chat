import { useEffect, useState } from "react";
import { notify } from "@/shared/lib/notify";
import { PersistenceQueue, registerPersistenceQueue } from "@/shared/lib/persistence";

export function reportPersistenceError(error: unknown): void {
  console.error("Persistence failed:", error);
  notify.error("Couldn't save changes", "Your latest changes may not survive a reload. Please try again.");
}

export function usePersistenceQueue(delayMs = 100): PersistenceQueue {
  const [queue] = useState(() => new PersistenceQueue(reportPersistenceError, delayMs));
  useEffect(() => {
    const unregister = registerPersistenceQueue(queue);
    const flush = () => {
      void queue.flush().catch(reportPersistenceError);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      // Keep this queue visible to a backup until its last write settles.
      // A failed unmount flush remains available to the next backup/flush.
      void queue.flush().then(unregister, reportPersistenceError);
    };
  }, [queue]);
  return queue;
}
