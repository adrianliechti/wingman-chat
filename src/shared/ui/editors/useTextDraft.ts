import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/shared/lib/notify";
import { dropDraft, getDraft, putDraft } from "./draftStore";

/** Own writes remembered so their echo from the file system is not taken for an outside change. */
const WRITE_ECHOES = 8;

/** What the host needs to offer Save and Discard for the file being edited. */
export interface DraftStatus {
  dirty: boolean;
  save: () => void;
  discard: () => void;
}

/** How an editor may change its file. Absent for read-only views (an archived revision). */
export interface FileEditing {
  /** Identifies the file's draft (see `draftKey`), which outlives the editor. */
  key: string;
  /** Writes the file. */
  save: (content: string) => Promise<unknown>;
  /** Reports unsaved edits so the host can offer Save and Discard. */
  onStatus?: (status: DraftStatus | null) => void;
}

export interface TextDraft {
  /** The text the editors show, with `\n` line breaks. */
  text: string;
  /** Changes when the editors must reload `text`: an outside change or a discard. */
  generation: number;
  /** The text differs from the file. */
  dirty: boolean;
  /** Absent when the file cannot be edited. */
  change?: (text: string) => void;
  /** Writes the edits to the file. */
  save: () => void;
  /** Drops the edits and shows the file again. */
  discard: () => void;
}

const toLf = (text: string) => text.replace(/\r\n/g, "\n");

const CHANGED_TITLE = "The file changed while you were editing";
const CHANGED_DETAIL = "Save keeps your version, with the other one in History; Discard loads the new one.";

/**
 * The editable state of one text file. Edits stay a draft until `save`;
 * `discard` drops them. A draft outlives the editor: closing it keeps the
 * edits in the draft store, and reopening the file picks them up again. A
 * change from elsewhere replaces the text when it is not edited and otherwise
 * waits behind the draft, which Save writes over it and Discard replaces.
 */
export function useTextDraft(content: string, editing?: FileEditing): TextDraft {
  const key = editing?.key;
  const write = editing?.save;
  const onStatus = editing?.onStatus;
  const [restored] = useState(() => (key ? getDraft(key) : undefined));
  const [draft, setDraft] = useState(() => {
    const base = toLf(content);
    return { text: restored ? restored.text : base, base, generation: 0 };
  });
  const writeRef = useRef(write);
  const crlfRef = useRef(content.includes("\r\n"));
  const pending = useRef<string | null>(restored && restored.text !== toLf(content) ? restored.text : null);
  const seen = useRef(content);
  const inFlight = useRef(0);
  const written = useRef<string[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    writeRef.current = write;
    crlfRef.current = content.includes("\r\n");
  });

  // Edits made against an older version of the file meet the same choice as a live conflict.
  const [restoredStale] = useState(
    () => !!restored && restored.base !== toLf(content) && restored.text !== toLf(content),
  );
  const warned = useRef(false);
  useEffect(() => {
    if (!restoredStale || warned.current) return;
    warned.current = true;
    notify.warning(CHANGED_TITLE, CHANGED_DETAIL);
  }, [restoredStale]);

  const save = useCallback(() => {
    const text = pending.current;
    const persist = writeRef.current;
    if (text === null || !persist) return;
    pending.current = null;
    setDraft((current) => ({ ...current, base: text }));
    const output = crlfRef.current ? text.replace(/\n/g, "\r\n") : text;
    written.current = [...written.current.slice(1 - WRITE_ECHOES), output];
    inFlight.current += 1;
    queue.current = queue.current
      .then(() => persist(output))
      .then(
        () => {
          inFlight.current -= 1;
        },
        (error: unknown) => {
          inFlight.current -= 1;
          if (pending.current === null) pending.current = text;
          setDraft((current) => ({ ...current, base: toLf(content) }));
          notify.error("Couldn't save your edits", error);
        },
      );
  }, [content]);

  const discard = useCallback(() => {
    pending.current = null;
    setDraft((current) =>
      current.text === current.base ? current : { ...current, text: current.base, generation: current.generation + 1 },
    );
  }, []);

  const change = useCallback((text: string) => {
    pending.current = text;
    setDraft((current) => ({ ...current, text }));
  }, []);

  useEffect(() => {
    // Only a new version of the file counts, not the one the editor opened with.
    if (content === seen.current) return;
    seen.current = content;
    // Our own write echoing back, or an outside write racing it: ours lands last.
    if (written.current.includes(content) || inFlight.current > 0) return;
    const text = toLf(content);
    if (pending.current !== null) {
      setDraft((current) => (current.base === text ? current : { ...current, base: text }));
      notify.warning(CHANGED_TITLE, CHANGED_DETAIL);
      return;
    }
    setDraft((current) =>
      current.text === text && current.base === text
        ? current
        : { text, base: text, generation: current.generation + 1 },
    );
  }, [content]);

  const dirty = draft.text !== draft.base;

  // The store holds the current edits, so they are there when the editor closes,
  // follow a rename, and mark the file as unsaved wherever it is listed.
  const { text, base } = draft;
  useEffect(() => {
    if (!key) return;
    if (text !== base) putDraft(key, { text, base });
    else dropDraft(key);
  }, [key, text, base]);

  useEffect(() => {
    if (!write) return;
    onStatus?.({ dirty, save, discard });
    return () => onStatus?.(null);
  }, [write, dirty, save, discard, onStatus]);

  return {
    text: draft.text,
    generation: draft.generation,
    dirty,
    change: write ? change : undefined,
    save,
    discard,
  };
}
