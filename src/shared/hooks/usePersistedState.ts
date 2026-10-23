import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withPersistenceLock } from "@/shared/lib/persistence";
import { reportPersistenceError, usePersistenceQueue } from "./usePersistenceQueue";
import * as opfs from "@/shared/lib/opfs";

/**
 * Options for usePersistedState hook
 */
export interface UsePersistedStateOptions<T> {
  /** File path in OPFS (e.g., 'profile.json') */
  key: string;

  /** Default value when no persisted data exists */
  defaultValue: T;

  /** Debounce delay in ms before saving (default: 0 = immediate) */
  debounceMs?: number;

  /** Optional validation/transformation on load */
  onLoad?: (data: T) => T;

  /** Optional transformation before save (return undefined to delete) */
  onSave?: (data: T) => T | undefined;
}

export interface UsePersistedStateReturn<T> {
  /** Current state value */
  value: T;

  /** Update the state */
  setValue: React.Dispatch<React.SetStateAction<T>>;

  /** Whether initial load from OPFS has completed */
  isLoaded: boolean;

  /** Force an immediate save (bypasses debounce) */
  flush: () => Promise<void>;
}

/** Loading and saving share one session per key and the ordinary persistence queue. */
export function usePersistedState<T>({
  key,
  defaultValue,
  debounceMs = 0,
  onLoad,
  onSave,
}: UsePersistedStateOptions<T>): UsePersistedStateReturn<T> {
  const [, render] = useState(0);
  const callbacks = useRef({ defaultValue, onLoad, onSave });
  callbacks.current = { defaultValue, onLoad, onSave };
  const queue = usePersistenceQueue(debounceMs);
  const session = useMemo(
    () => ({
      key,
      value: callbacks.current.defaultValue,
      loaded: false,
      edits: [] as React.SetStateAction<T>[],
      loading: undefined as Promise<void> | undefined,
    }),
    [key],
  );

  useEffect(() => {
    let active = true;
    const { defaultValue: initialValue, onLoad: transform } = callbacks.current;
    session.loading ??= opfs.readJson<T>(session.key).then((data) => {
      let value = data === undefined ? initialValue : transform ? transform(data) : data;
      // Rebase edits made during loading onto the saved value. An explicit
      // replacement remains a replacement; functional updates keep other fields.
      for (const edit of session.edits) value = typeof edit === "function" ? (edit as (value: T) => T)(value) : edit;
      session.value = value;
      session.edits = [];
      session.loaded = true;
    });
    void session.loading
      .then(() => {
        if (active) render((n) => n + 1);
      })
      .catch(reportPersistenceError);
    return () => {
      active = false;
    };
  }, [session]);

  const setValue = useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (edit) => {
      session.value = typeof edit === "function" ? (edit as (value: T) => T)(session.value) : edit;
      if (!session.loaded) session.edits.push(edit);
      const deferSnapshot = !session.loaded;
      const snapshot = session.value;
      const transform = callbacks.current.onSave;
      queue.schedule(session.key, async () => {
        await session.loading;
        const value = deferSnapshot ? session.value : snapshot;
        const stored = transform ? transform(value) : value;
        await withPersistenceLock("collection:profile", () =>
          stored === undefined ? opfs.deleteFile(session.key) : opfs.writeJson(session.key, stored),
        );
      });
      render((n) => n + 1);
    },
    [queue, session],
  );

  const flush = useCallback(async () => {
    await session.loading;
    await queue.flushRecord(session.key);
  }, [queue, session]);

  return { value: session.value, setValue, isLoaded: session.loaded, flush };
}
