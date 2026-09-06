import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/shared/lib/notify";
import { reportPersistenceError, usePersistenceQueue } from "./usePersistenceQueue";

interface CollectionStorage<T> {
  load: () => Promise<T[]>;
  store: (item: T) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** Shared ownership of collection state and its ordered persistence queue. */
export function usePersistentCollection<T extends { id: string }>(storage: CollectionStorage<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const itemsRef = useRef(items);
  const touched = useRef(new Set<string>());
  const queue = usePersistenceQueue();
  const storageRef = useRef(storage);
  storageRef.current = storage;

  const publish = useCallback((next: T[]) => {
    // Synchronous ownership lets two edits in the same event see each other.
    // Filesystem work and timers never run inside a React state updater.
    itemsRef.current = next;
    setItems(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void storageRef.current
      .load()
      .then((loaded) => {
        if (cancelled) return;
        const local = itemsRef.current;
        publish([
          ...local,
          ...loaded.filter((item) => !touched.current.has(item.id) && !local.some((current) => current.id === item.id)),
        ]);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load saved data:", error);
        notify.error("Couldn't load saved data", error);
      })
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [publish]);

  const put = useCallback(
    (item: T): T => {
      touched.current.add(item.id);
      publish([item, ...itemsRef.current.filter((current) => current.id !== item.id)]);
      queue.schedule(item.id, () => storageRef.current.store(item));
      return item;
    },
    [publish, queue],
  );

  const create = useCallback(
    async (item: T): Promise<T> => {
      put(item);
      try {
        await queue.flushRecord(item.id);
      } catch (error) {
        reportPersistenceError(error);
        throw error;
      }
      return item;
    },
    [put, queue],
  );

  const update = useCallback(
    (id: string, updater: (item: T) => T) => {
      const current = itemsRef.current.find((item) => item.id === id);
      if (!current) return;
      const next = { ...updater(current), id };
      touched.current.add(id);
      publish(itemsRef.current.map((item) => (item.id === id ? next : item)));
      queue.schedule(id, () => storageRef.current.store(next));
    },
    [publish, queue],
  );

  const remove = useCallback(
    async (id: string) => {
      touched.current.add(id);
      publish(itemsRef.current.filter((item) => item.id !== id));
      queue.schedule(id, () => storageRef.current.remove(id));
      try {
        await queue.flushRecord(id);
      } catch (error) {
        reportPersistenceError(error);
        throw error;
      }
    },
    [publish, queue],
  );

  const getItems = useCallback(() => itemsRef.current, []);
  return { items, isLoaded, create, put, update, remove, getItems };
}
