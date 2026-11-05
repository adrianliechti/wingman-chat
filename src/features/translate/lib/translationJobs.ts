import type { Translation } from "../types/translate";
import { readTranslationFile, removeTranslationFile, writeTranslationFile } from "./translationStorage";
import {
  fingerprint,
  rewrite,
  translateFile,
  translateText,
  type TranslatorClient,
  type TranslatorOptions,
} from "./translator";

/** What a job run needs from its owner: the gateway, the latest job state and a way to change it. */
export interface JobRuntime {
  client: TranslatorClient;
  options: TranslatorOptions;
  get: (id: string) => Translation | undefined;
  patch: (id: string, updater: (job: Translation) => Translation) => void;
  controllers: Map<string, AbortController>;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Cancel a job's request, if one is in flight. */
export function abortJob(runtime: JobRuntime, id: string): void {
  runtime.controllers.get(id)?.abort();
  runtime.controllers.delete(id);
}

function begin(runtime: JobRuntime, id: string): AbortController {
  abortJob(runtime, id);
  const controller = new AbortController();
  runtime.controllers.set(id, controller);
  runtime.patch(id, (job) => ({ ...job, status: "running", error: undefined }));
  return controller;
}

function end(runtime: JobRuntime, id: string, controller: AbortController): void {
  if (runtime.controllers.get(id) === controller) runtime.controllers.delete(id);
}

/** A text job's result cleared, e.g. when its text is emptied. */
export const CLEARED_RESULT: Pick<
  Translation,
  "translatedText" | "translatedKey" | "resultText" | "resultFile" | "status" | "error"
> = {
  translatedText: undefined,
  translatedKey: undefined,
  resultText: undefined,
  resultFile: undefined,
  status: "idle",
  error: undefined,
};

/**
 * Translate a text job, then apply its formality and style. The translation is
 * reused when only the formality or style changed since it was produced.
 */
export async function runTextJob(runtime: JobRuntime, id: string): Promise<void> {
  const job = runtime.get(id);
  if (!job || job.kind !== "text" || !job.sourceText.trim()) return;
  const controller = begin(runtime, id);
  const { signal } = controller;
  try {
    const key = fingerprint([job.sourceText, job.provider, job.targetLang]);
    let translated = job.translatedKey === key ? job.translatedText : undefined;
    if (translated === undefined) {
      translated = await translateText(
        runtime.client,
        runtime.options,
        { text: job.sourceText, provider: job.provider, targetLang: job.targetLang },
        signal,
      );
      signal.throwIfAborted();
    }
    const result = await rewrite(
      runtime.client,
      runtime.options,
      translated,
      job.targetLang,
      { formality: job.formality, style: job.style, source: job.sourceText },
      signal,
    );
    signal.throwIfAborted();
    runtime.patch(id, (current) => ({
      ...current,
      translatedText: translated,
      translatedKey: key,
      resultText: result,
      status: "done",
      error: undefined,
    }));
  } catch (error) {
    if (!signal.aborted) {
      runtime.patch(id, (current) => ({
        ...current,
        status: "error",
        error: errorMessage(error, "Translation failed."),
      }));
    }
  }
  end(runtime, id, controller);
}

/** Translate a file job's stored document; the result is a document or text shown beside the original. */
export async function runFileJob(runtime: JobRuntime, id: string): Promise<void> {
  const job = runtime.get(id);
  if (!job || job.kind !== "file" || !job.sourceFile) return;
  const controller = begin(runtime, id);
  const { signal } = controller;
  try {
    const file = await readTranslationFile(id, "source", job.sourceFile);
    if (!file) throw new Error("The original document is no longer stored.");
    signal.throwIfAborted();
    const result = await translateFile(runtime.client, runtime.options, file, job.provider, job.targetLang, signal);
    signal.throwIfAborted();
    if (result.kind === "document") {
      await writeTranslationFile(id, "result", result.blob);
      signal.throwIfAborted();
      runtime.patch(id, (current) => ({
        ...current,
        resultFile: { name: result.name, contentType: result.blob.type, size: result.blob.size },
        translatedText: undefined,
        translatedKey: undefined,
        resultText: undefined,
        status: "done",
        error: undefined,
      }));
    } else {
      await removeTranslationFile(id, "result");
      signal.throwIfAborted();
      runtime.patch(id, (current) => ({
        ...current,
        resultFile: {
          name: result.name,
          contentType: result.name.endsWith(".md") ? "text/markdown" : "text/plain",
          size: new TextEncoder().encode(result.text).length,
        },
        translatedText: result.text,
        translatedKey: undefined,
        resultText: result.text,
        status: "done",
        error: undefined,
      }));
    }
  } catch (error) {
    if (!signal.aborted) {
      runtime.patch(id, (current) => ({
        ...current,
        status: "error",
        error: errorMessage(error, "Translation failed."),
      }));
    }
  }
  end(runtime, id, controller);
}

/** Rewrite a job's result text with a free instruction. Throws so the caller can report it. */
export async function refineJob(runtime: JobRuntime, id: string, instruction: string): Promise<void> {
  const job = runtime.get(id);
  if (!job || !job.resultText?.trim() || !instruction.trim()) return;
  const controller = new AbortController();
  const { signal } = controller;
  const key = `${id}:refine`;
  runtime.controllers.get(key)?.abort();
  runtime.controllers.set(key, controller);
  try {
    const result = await rewrite(
      runtime.client,
      runtime.options,
      job.resultText,
      job.targetLang,
      { instruction, source: job.kind === "text" ? job.sourceText : undefined },
      signal,
    );
    signal.throwIfAborted();
    runtime.patch(id, (current) => ({ ...current, resultText: result }));
  } finally {
    if (runtime.controllers.get(key) === controller) runtime.controllers.delete(key);
  }
}

/** A new file job for `file`; the document is stored before the job is created. */
export async function prepareFileJob(
  id: string,
  file: File,
  settings: Pick<Translation, "provider" | "targetLang" | "formality" | "style">,
): Promise<Translation> {
  await writeTranslationFile(id, "source", file);
  const now = new Date();
  return {
    id,
    kind: "file",
    created: now,
    updated: now,
    provider: settings.provider,
    targetLang: settings.targetLang,
    formality: settings.formality,
    style: settings.style,
    sourceText: "",
    sourceFile: { name: file.name, contentType: file.type, size: file.size },
    status: "idle",
  };
}

/** Copy a file job's document into a new job for another language or translator. */
export async function cloneFileJob(
  source: Translation,
  id: string,
  settings: Partial<Pick<Translation, "provider" | "targetLang">>,
): Promise<Translation> {
  const file = await readTranslationFile(source.id, "source", source.sourceFile);
  if (!file) throw new Error("The original document is no longer stored.");
  return prepareFileJob(id, file, { ...source, ...settings });
}
