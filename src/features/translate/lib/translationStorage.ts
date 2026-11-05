import type { StoredFile, Translation, TranslationKind, TranslationStatus } from "../types/translate";
import { formalityOptions, knownOption, styleOptions } from "./languages";
import * as opfs from "@/shared/lib/opfs";
import { withPersistenceLock } from "@/shared/lib/persistence";

export const COLLECTION = "translations";

// OPFS layout
// /translations/{id}/metadata.json   the job without its documents
// /translations/{id}/source.bin      a file job's original document
// /translations/{id}/result.bin      the translated document, when the translator returns one

export interface StoredTranslation {
  id: string;
  kind: TranslationKind;
  /** Listing title: the file name or the first words of the text. */
  title: string;
  created: string;
  updated: string;
  provider: string;
  targetLang: string;
  formality?: string;
  style?: string;
  sourceText?: string;
  sourceFile?: StoredFile;
  translatedText?: string;
  translatedKey?: string;
  resultText?: string;
  resultFile?: StoredFile;
  status: TranslationStatus;
  error?: string;
}

export type TranslationFile = "source" | "result";

/** Listing title: the document's name or the first words of the text. */
export function translationTitle(translation: Pick<Translation, "kind" | "sourceText" | "sourceFile">): string {
  if (translation.kind === "file") return translation.sourceFile?.name ?? "Document";
  const line = translation.sourceText.trim().split(/\s+/).join(" ");
  if (!line) return "New translation";
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

export function serializeTranslation(translation: Translation): StoredTranslation {
  return {
    id: translation.id,
    kind: translation.kind,
    title: translationTitle(translation),
    created: translation.created.toISOString(),
    updated: translation.updated.toISOString(),
    provider: translation.provider,
    targetLang: translation.targetLang,
    formality: translation.formality || undefined,
    style: translation.style || undefined,
    sourceText: translation.kind === "text" ? translation.sourceText : undefined,
    sourceFile: translation.sourceFile,
    translatedText: translation.translatedText,
    translatedKey: translation.translatedKey,
    resultText: translation.resultText,
    resultFile: translation.resultFile,
    // A request does not survive a reload; it is reported as interrupted when read back.
    status: translation.status,
    error: translation.error,
  };
}

const date = (value: string | undefined, fallback: Date): Date => {
  const parsed = value ? new Date(value) : fallback;
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
};

/** Build the in-memory job from its stored form; an interrupted request becomes an error. */
export function hydrateTranslation(meta: StoredTranslation): Translation {
  const interrupted = meta.status === "running" || meta.status === "idle";
  const created = date(meta.created, new Date(0));
  return {
    id: meta.id,
    kind: meta.kind === "file" ? "file" : "text",
    created,
    updated: date(meta.updated, created),
    provider: meta.provider ?? "",
    targetLang: meta.targetLang ?? "",
    formality: knownOption(formalityOptions(), meta.formality),
    style: knownOption(styleOptions(), meta.style),
    sourceText: meta.sourceText ?? "",
    sourceFile: meta.sourceFile,
    translatedText: meta.translatedText,
    translatedKey: meta.translatedKey,
    resultText: meta.resultText,
    resultFile: meta.resultFile,
    status: interrupted ? "error" : meta.status,
    error: interrupted ? "The translation was interrupted. Try again." : meta.error,
  };
}

export async function storeTranslation(translation: Translation): Promise<void> {
  return withPersistenceLock(`collection:${COLLECTION}`, async () => {
    const meta = serializeTranslation(translation);
    await opfs.writeJson(`${COLLECTION}/${translation.id}/metadata.json`, meta);
    await opfs.upsertIndexEntry(COLLECTION, {
      id: translation.id,
      title: meta.title,
      created: meta.created,
      updated: meta.updated,
    });
  });
}

export async function loadTranslation(id: string): Promise<Translation | undefined> {
  try {
    const meta = await opfs.readJson<StoredTranslation>(`${COLLECTION}/${id}/metadata.json`);
    return meta ? hydrateTranslation({ ...meta, id }) : undefined;
  } catch (error) {
    console.error(`Error loading translation ${id} from OPFS:`, error);
    return undefined;
  }
}

export async function loadTranslations(): Promise<Translation[]> {
  return withPersistenceLock(`collection:${COLLECTION}`, async () => {
    const translations: Translation[] = [];
    for (const entry of await opfs.readIndex(COLLECTION)) {
      const translation = await loadTranslation(entry.id);
      if (translation) translations.push(translation);
    }
    return translations.sort((a, b) => b.updated.getTime() - a.updated.getTime());
  });
}

export async function removeTranslation(id: string): Promise<void> {
  return withPersistenceLock(`collection:${COLLECTION}`, async () => {
    await opfs.deleteDirectory(`${COLLECTION}/${id}`);
    await opfs.removeIndexEntry(COLLECTION, id);
  });
}

/** Store a job's original or translated document. */
export async function writeTranslationFile(id: string, which: TranslationFile, blob: Blob): Promise<void> {
  await opfs.writeBlob(`${COLLECTION}/${id}/${which}.bin`, blob);
}

/** Read a stored document with its recorded type, since OPFS keeps bytes only. */
export async function readTranslationFile(
  id: string,
  which: TranslationFile,
  info?: StoredFile,
): Promise<File | undefined> {
  const blob = await opfs.readBlob(`${COLLECTION}/${id}/${which}.bin`);
  if (!blob) return undefined;
  return new File([blob], info?.name ?? `${which}.bin`, { type: info?.contentType ?? "application/octet-stream" });
}

export async function removeTranslationFile(id: string, which: TranslationFile): Promise<void> {
  await opfs.deleteFile(`${COLLECTION}/${id}/${which}.bin`).catch(() => {});
}
