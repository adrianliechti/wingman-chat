import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { notify } from "@/shared/lib/notify";
import { reportPersistenceError, usePersistenceQueue } from "./usePersistenceQueue";
import { subscribeStorageChanges } from "@/shared/lib/storageChanges";

interface CollectionStorage<T> {
  load: () => Promise<T[]>;
  store: (item: T) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** Shared ownership of collection state and its ordered persistence queue. */
export function usePersistentCollection<T extends { id: string }>(storage: CollectionStorage<T>, collection: string) {
  const [items, setItems] = useState<T[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const itemsRef = useRef(items);
  const versions = useRef(new Map<string, number>());
  const queue = usePersistenceQueue();
  const storageRef = useRef(storage);
  useLayoutEffect(() => {
    storageRef.current = storage;
  });

  const publish = useCallback((next: T[]) => {
    // Synchronous ownership lets two edits in the same event see each other.
    // Filesystem work and timers never run inside a React state updater.
    itemsRef.current = next;
    setItems(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    const load = async (initial = false) => {
      const current = ++request;
      const before = new Map(versions.current);
      try {
        const loaded = await storageRef.current.load();
        if (cancelled || current !== request) return;
        const protectedIds = new Set(
          [...versions.current.keys(), ...loaded.map((item) => item.id)].filter(
            (id) =>
              queue.hasPending(id) ||
              before.get(id) !== versions.current.get(id) ||
              (initial && versions.current.has(id)),
          ),
        );
        publish([
          ...itemsRef.current.filter((item) => protectedIds.has(item.id)),
          ...loaded.filter((item) => !protectedIds.has(item.id)),
        ]);
      } catch (error) {
        if (!cancelled) notify.error("Couldn't load saved data", error);
      } finally {
        if (!cancelled && current === request) setIsLoaded(true);
      }
    };
    void load(true);
    const unsubscribe = subscribeStorageChanges((paths) => {
      if (paths.some((path) => path.startsWith(`${collection}/`))) void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [collection, publish, queue]);

  const put = useCallback(
    (item: T): T => {
      versions.current.set(item.id, (versions.current.get(item.id) ?? 0) + 1);
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
      versions.current.set(id, (versions.current.get(id) ?? 0) + 1);
      publish(itemsRef.current.map((item) => (item.id === id ? next : item)));
      queue.schedule(id, () => storageRef.current.store(next));
    },
    [publish, queue],
  );

  const remove = useCallback(
    async (id: string) => {
      versions.current.set(id, (versions.current.get(id) ?? 0) + 1);
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
  const flush = useCallback(
    async (id: string) => {
      try {
        await queue.flushRecord(id);
      } catch (error) {
        reportPersistenceError(error);
        throw error;
      }
    },
    [queue],
  );
  return { items, isLoaded, create, put, update, remove, getItems, flush };
}
