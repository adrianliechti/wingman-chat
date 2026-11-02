import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePersistenceQueue } from "@/shared/hooks/usePersistenceQueue";
import { ComposerDraftStore, type ComposerDraft } from "../lib/composerDrafts";

const Context = createContext<ComposerDraftStore | null>(null);
export function ComposerDraftProvider({ children }: { children: ReactNode }) {
  const queue = usePersistenceQueue();
  const [store] = useState(() => new ComposerDraftStore(queue));
  return <Context value={store}>{children}</Context>;
}
export function useComposerDraftStore() {
  const store = useContext(Context);
  if (!store) throw new Error("ComposerDraftProvider is required");
  return store;
}
export function useComposerDraft(key: string) {
  const store = useComposerDraftStore();
  const get = useCallback(() => store.get(key), [store, key]);
  const state = useSyncExternalStore(store.subscribe, get, get);
  useEffect(() => {
    void store.load(key).catch(() => {});
  }, [store, key]);
  const update = useCallback((edit: (draft: ComposerDraft) => ComposerDraft) => store.update(key, edit), [store, key]);
  return { ...state, update, store };
}
