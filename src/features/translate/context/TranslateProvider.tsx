import { Debouncer } from "@tanstack/pacer";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  isSupportedFile,
  pickLanguage,
  providerForFile,
  styleOptions,
  supportedFiles,
  supportedLanguages,
  supportedProviders,
  formalityOptions,
  type SupportedFile,
} from "../lib/languages";
import {
  abortJob,
  CLEARED_RESULT,
  cloneFileJob,
  type JobRuntime,
  prepareFileJob,
  refineJob,
  runFileJob,
  runTextJob,
} from "../lib/translationJobs";
import { loadTranslations, removeTranslation, storeTranslation } from "../lib/translationStorage";
import { fileLimitError, type TranslatorOptions } from "../lib/translator";
import type { Translation } from "../types/translate";
import { getConfig } from "@/shared/config";
import { usePersistentCollection } from "@/shared/hooks/usePersistentCollection";
import { notify } from "@/shared/lib/notify";
import { TranslateContext, type TranslateContextType, type TranslateDraft } from "./TranslateContext";

const PREFERENCES_KEY = "translate_preferences";
/** Typing pauses this long before a translation request starts. */
const TYPING_PAUSE_MS = 1000;

const storage = { load: loadTranslations, store: storeTranslation, remove: removeTranslation };
/** Nothing is read or written while no translator is configured. */
const noStorage = { load: async () => [] as Translation[], store: async () => {}, remove: async () => {} };

interface Preferences {
  targetLang?: string;
  provider?: string;
}

function readPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    return stored ? (JSON.parse(stored) as Preferences) : {};
  } catch {
    return {};
  }
}

function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...readPreferences(), ...preferences }));
  } catch {
    // The choice stays for this session only.
  }
}

function initialDraft(): TranslateDraft {
  const preferences = readPreferences();
  const providers = supportedProviders();
  const provider = providers.some((item) => item.id === preferences.provider)
    ? preferences.provider!
    : (providers[0]?.id ?? "");
  const targetLang = pickLanguage(
    supportedLanguages(provider).map((language) => language.code),
    preferences.targetLang,
  );
  return { sourceText: "", targetLang, provider, formality: "", style: "" };
}

/** File types any translator accepts, without duplicates. */
function acceptedFileTypes(): SupportedFile[] {
  const providers = supportedProviders();
  const all = providers.length ? providers.flatMap((provider) => supportedFiles(provider.id)) : supportedFiles();
  const seen = new Set<string>();
  return all.filter((file) => {
    const key = file.ext.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function draftOf(job: Translation): TranslateDraft {
  return {
    sourceText: job.sourceText,
    targetLang: job.targetLang,
    provider: job.provider,
    formality: job.formality,
    style: job.style,
  };
}

function newTextJob(draft: TranslateDraft): Translation {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    kind: "text",
    created: now,
    updated: now,
    provider: draft.provider,
    targetLang: draft.targetLang,
    formality: draft.formality,
    style: draft.style,
    sourceText: draft.sourceText,
    status: "idle",
  };
}

/** Sort out which dropped files can be translated and by whom. */
function admitFiles(
  files: File[],
  provider: string,
  options: TranslatorOptions,
): { accepted: { file: File; provider: string }[]; rejected: string[] } {
  const accepted: { file: File; provider: string }[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const chosen = providerForFile(file, provider);
    if (chosen === undefined) {
      rejected.push(`${file.name}: unsupported file type`);
      continue;
    }
    const limit = fileLimitError(file, options);
    if (limit) {
      rejected.push(limit);
      continue;
    }
    accepted.push({ file, provider: chosen });
  }
  return { accepted, rejected };
}

export function TranslateProvider({ children }: { children: ReactNode }) {
  const config = getConfig();
  const translator = config.translator;
  const { items, isLoaded, create, update, remove, getItems } = usePersistentCollection(
    translator ? storage : noStorage,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TranslateDraft>(initialDraft);

  const options = useMemo<TranslatorOptions>(
    () => ({
      model: translator?.model,
      maxFileSize: translator?.maxFileSize,
      maxTextLength: translator?.maxTextLength,
    }),
    [translator?.model, translator?.maxFileSize, translator?.maxTextLength],
  );

  // One request per job id; the map outlives renders without being read during them.
  const [controllers] = useState(() => new Map<string, AbortController>());
  const runtime = useMemo<JobRuntime>(
    () => ({
      client: config.client,
      options,
      get: (id) => getItems().find((job) => job.id === id),
      patch: (id, updater) => update(id, (job) => ({ ...updater(job), updated: new Date() })),
      controllers,
    }),
    [config.client, options, getItems, update, controllers],
  );

  const active = useMemo(
    () => (activeId ? (items.find((job) => job.id === activeId) ?? null) : null),
    [items, activeId],
  );
  // The open text job is the composer; before one exists, the draft is.
  const composer = active?.kind === "text" ? draftOf(active) : draft;

  // The debounced run reads the latest state through a ref: its timer fires outside React.
  const latest = useRef({ active, draft, runtime, create });
  useLayoutEffect(() => {
    latest.current = { active, draft, runtime, create };
  });

  const translateDraft = useCallback(async () => {
    const { active, draft, runtime, create } = latest.current;
    let id = active?.kind === "text" ? active.id : null;
    if (id === null) {
      if (!draft.sourceText.trim()) return;
      const job = newTextJob(draft);
      await create(job);
      id = job.id;
      setActiveId(id);
      setDraft((current) => ({ ...current, sourceText: "" }));
    }
    await runTextJob(runtime, id);
  }, []);

  // Created on first use, from a handler: the timer callback must see the latest state.
  const schedulerRef = useRef<Debouncer<() => void> | null>(null);
  const scheduler = useCallback(() => {
    if (!schedulerRef.current) {
      schedulerRef.current = new Debouncer(
        () => {
          void translateDraft().catch((error: unknown) => notify.error("Translation failed", error));
        },
        { wait: TYPING_PAUSE_MS },
      );
    }
    return schedulerRef.current;
  }, [translateDraft]);

  // File jobs translate one after another.
  const fileQueue = useRef(Promise.resolve());
  const enqueueFile = useCallback(
    (id: string) => {
      fileQueue.current = fileQueue.current.then(() => runFileJob(runtime, id)).catch(() => {});
    },
    [runtime],
  );

  /** Apply a change to the composer: the open text job and the remembered draft. */
  const changeComposer = useCallback(
    (patch: Partial<Omit<TranslateDraft, "sourceText">>) => {
      setDraft((current) => ({ ...current, ...patch }));
      const job = latest.current.active;
      if (job?.kind === "text") {
        runtime.patch(job.id, (current) => ({ ...current, ...patch }));
        if (job.sourceText.trim()) scheduler().maybeExecute();
      } else if (latest.current.draft.sourceText.trim()) {
        scheduler().maybeExecute();
      }
    },
    [runtime, scheduler],
  );

  /** Translate an open file job again, into another language or with another translator. */
  const retargetFile = useCallback(
    (job: Translation, patch: Partial<Pick<Translation, "provider" | "targetLang">>) => {
      if (job.status !== "done") {
        abortJob(runtime, job.id);
        runtime.patch(job.id, (current) => ({ ...current, ...patch, status: "idle", error: undefined }));
        enqueueFile(job.id);
        return;
      }
      const id = crypto.randomUUID();
      cloneFileJob(job, id, patch)
        .then((clone) => create(clone))
        .then(() => {
          setActiveId(id);
          enqueueFile(id);
        })
        .catch((error: unknown) => notify.error("Couldn't translate the document again", error));
    },
    [runtime, create, enqueueFile],
  );

  /** A text job whose text was cleared leaves no empty entry behind. */
  const dropEmptyActive = useCallback(() => {
    const job = latest.current.active;
    if (job?.kind === "text" && !job.sourceText.trim()) {
      abortJob(runtime, job.id);
      void remove(job.id).catch(() => {});
    }
  }, [runtime, remove]);

  const setSourceText = useCallback(
    (text: string) => {
      const job = latest.current.active;
      if (job?.kind === "text") {
        if (text.trim()) {
          runtime.patch(job.id, (current) => ({ ...current, sourceText: text }));
        } else {
          abortJob(runtime, job.id);
          runtime.patch(job.id, (current) => ({ ...current, sourceText: text, ...CLEARED_RESULT }));
        }
      } else {
        setDraft((current) => ({ ...current, sourceText: text }));
      }
      if (text.trim()) scheduler().maybeExecute();
      else scheduler().cancel();
    },
    [runtime, scheduler],
  );

  const setTargetLang = useCallback(
    (targetLang: string) => {
      savePreferences({ targetLang });
      const job = latest.current.active;
      if (job?.kind === "file") {
        setDraft((current) => ({ ...current, targetLang }));
        if (job.targetLang !== targetLang) retargetFile(job, { targetLang });
        return;
      }
      changeComposer({ targetLang });
    },
    [changeComposer, retargetFile],
  );

  const setProvider = useCallback(
    (provider: string) => {
      savePreferences({ provider });
      const job = latest.current.active;
      const current = job ? job.targetLang : latest.current.draft.targetLang;
      // Keep the target language when the new translator offers it.
      const targetLang = pickLanguage(
        supportedLanguages(provider).map((language) => language.code),
        current,
      );
      if (job?.kind === "file") {
        setDraft((state) => ({ ...state, provider, targetLang }));
        if (job.provider !== provider) retargetFile(job, { provider, targetLang });
        return;
      }
      changeComposer({ provider, targetLang });
    },
    [changeComposer, retargetFile],
  );

  const setFormality = useCallback((formality: string) => changeComposer({ formality }), [changeComposer]);
  const setStyle = useCallback((style: string) => changeComposer({ style }), [changeComposer]);

  const translateNow = useCallback(() => {
    scheduler().cancel();
    void translateDraft().catch((error: unknown) => notify.error("Translation failed", error));
  }, [scheduler, translateDraft]);

  const addFiles = useCallback(
    async (files: File[]) => {
      const { active, draft, runtime, create } = latest.current;
      const settings = active?.kind === "text" ? draftOf(active) : draft;
      const { accepted, rejected } = admitFiles(files, settings.provider, runtime.options);
      if (rejected.length) {
        notify.error(accepted.length ? "Some files were skipped" : "Couldn't translate the file", rejected.join("\n"));
      }
      if (!accepted.length) return;
      scheduler().cancel();
      let first: string | null = null;
      for (const { file, provider } of accepted) {
        const id = crypto.randomUUID();
        try {
          const job = await prepareFileJob(id, file, { ...settings, provider });
          await create(job);
        } catch (error) {
          notify.error(`Couldn't add ${file.name}`, error);
          continue;
        }
        if (first === null) first = id;
        enqueueFile(id);
      }
      if (first) {
        dropEmptyActive();
        setActiveId(first);
      }
    },
    [scheduler, enqueueFile, dropEmptyActive],
  );

  const open = useCallback(
    (id: string) => {
      scheduler().cancel();
      if (latest.current.active?.id !== id) dropEmptyActive();
      setActiveId(id);
    },
    [scheduler, dropEmptyActive],
  );

  const newTranslation = useCallback(() => {
    scheduler().cancel();
    dropEmptyActive();
    setActiveId(null);
    setDraft((current) => ({ ...current, sourceText: "" }));
  }, [scheduler, dropEmptyActive]);

  const removeJob = useCallback(
    async (id: string) => {
      abortJob(runtime, id);
      setActiveId((current) => (current === id ? null : current));
      await remove(id);
    },
    [runtime, remove],
  );

  const retry = useCallback(
    (id: string) => {
      const job = runtime.get(id);
      if (!job) return;
      if (job.kind === "file") {
        runtime.patch(id, (current) => ({ ...current, status: "idle", error: undefined }));
        enqueueFile(id);
      } else {
        void runTextJob(runtime, id);
      }
    },
    [runtime, enqueueFile],
  );

  const cancel = useCallback(
    (id: string) => {
      abortJob(runtime, id);
      runtime.patch(id, (current) => ({
        ...current,
        status: current.resultText || current.resultFile ? "done" : "idle",
        error: undefined,
      }));
    },
    [runtime],
  );

  const refine = useCallback((id: string, instruction: string) => refineJob(runtime, id, instruction), [runtime]);
  const revertRefinement = useCallback(
    (id: string) => {
      const job = runtime.get(id);
      if (!job || job.translatedText === undefined) return;
      if (job.kind === "text") void runTextJob(runtime, id);
      else runtime.patch(id, (current) => ({ ...current, resultText: current.translatedText }));
    },
    [runtime],
  );
  const replaceResult = useCallback(
    (id: string, text: string) => runtime.patch(id, (current) => ({ ...current, resultText: text })),
    [runtime],
  );

  const providers = useMemo(() => supportedProviders(), []);
  const acceptedFiles = useMemo(() => acceptedFileTypes(), []);
  const languages = useMemo(() => supportedLanguages(composer.provider), [composer.provider]);
  const files = useMemo(() => supportedFiles(composer.provider), [composer.provider]);
  const formalities = useMemo(() => formalityOptions(), []);
  const styles = useMemo(() => styleOptions(), []);

  const value: TranslateContextType = {
    translations: items,
    isLoaded,
    active,
    draft: composer,
    providers,
    languages,
    files,
    acceptedFiles,
    formalityOptions: formalities,
    styleOptions: styles,
    setSourceText,
    setTargetLang,
    setProvider,
    setFormality,
    setStyle,
    translateNow,
    addFiles,
    open,
    newTranslation,
    remove: removeJob,
    retry,
    cancel,
    refine,
    revertRefinement,
    replaceResult,
  };

  return <TranslateContext value={value}>{children}</TranslateContext>;
}

export { isSupportedFile };
