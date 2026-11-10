import { type Client, HttpError } from "@/shared/lib/client";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { fileExtension, formatBytes } from "@/shared/lib/utils";

/** The gateway calls a translation needs. */
export type TranslatorClient = Pick<Client, "translate" | "rewriteText">;

export interface TranslatorOptions {
  /** Model used to rewrite translations (formality, style, refinements). */
  model?: string;
  maxFileSize?: number;
  maxTextLength?: number;
}

export interface TextInput {
  text: string;
  provider: string;
  targetLang: string;
}

export interface Rewrite {
  formality?: string;
  style?: string;
  instruction?: string;
  /** The untranslated original, as a fidelity reference. */
  source?: string;
}

export type FileTranslation =
  | { kind: "document"; blob: Blob; name: string }
  | { kind: "text"; text: string; name: string };

/** Short, stable hash (FNV-1a) of the pieces that make a translation request. */
export function fingerprint(parts: unknown[]): string {
  const input = JSON.stringify(parts);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0") + input.length.toString(16);
}

export function textLimitError(text: string, options: TranslatorOptions): string | null {
  const { maxTextLength } = options;
  if (maxTextLength != null && text.length > maxTextLength) {
    return `Text is ${text.length.toLocaleString()} characters, over the ${maxTextLength.toLocaleString()} limit.`;
  }
  return null;
}

export function fileLimitError(file: Pick<File, "name" | "size">, options: TranslatorOptions): string | null {
  const { maxFileSize } = options;
  if (maxFileSize != null && file.size > maxFileSize) {
    return `"${file.name}" is ${formatBytes(file.size)}, over the ${formatBytes(maxFileSize)} limit.`;
  }
  return null;
}

async function asText(result: string | Blob): Promise<string> {
  return typeof result === "string" ? result : new TextDecoder().decode(new Uint8Array(await result.arrayBuffer()));
}

/** Translate text as is; formality and style are applied by `rewrite`. */
export async function translateText(
  client: TranslatorClient,
  options: TranslatorOptions,
  input: TextInput,
  signal?: AbortSignal,
): Promise<string> {
  const limit = textLimitError(input.text, options);
  if (limit) throw new Error(limit);
  const result = await client.translate(input.provider, input.targetLang, input.text, { signal });
  return asText(result);
}

/** Apply a formality, a style and/or a free instruction to translated text in `lang`. */
export async function rewrite(
  client: TranslatorClient,
  options: TranslatorOptions,
  text: string,
  lang: string,
  change: Rewrite,
  signal?: AbortSignal,
): Promise<string> {
  if (!change.formality && !change.style && !change.instruction?.trim()) return text;
  return client.rewriteText(options.model ?? "", text, { lang, ...change }, { signal });
}

/** `report.docx` → `report_de.docx`; `ext` replaces the extension (`report_de.md`). */
export function translatedFileName(name: string, lang: string, ext?: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = ext ?? (dot > 0 ? name.slice(dot) : "");
  return `${base}_${lang}${extension}`;
}

/** Text results of a document keep a text source's extension and become Markdown otherwise. */
function textResultExtension(file: Pick<File, "name" | "type">): string {
  const type = file.type || inferContentTypeFromPath(file.name);
  if (type && type !== "application/octet-stream" && isTextContentType(type)) {
    const ext = fileExtension(file.name);
    if (ext) return `.${ext}`;
  }
  return ".md";
}

/** Translators that answered 406 to a document request; they are asked for text from then on. */
const textOnlyProviders = new Set<string>();

/**
 * Translate a whole document. The translator is asked for a document of the
 * same type first; one that only produces text (the gateway answers 406) is
 * asked again for text, which is then shown beside the original.
 */
export async function translateFile(
  client: TranslatorClient,
  options: TranslatorOptions,
  file: File,
  provider: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<FileTranslation> {
  const limit = fileLimitError(file, options);
  if (limit) throw new Error(limit);
  let result: string | Blob;
  if (textOnlyProviders.has(provider)) {
    result = await client.translate(provider, targetLang, file, { signal, accept: "text/plain" });
  } else {
    try {
      result = await client.translate(provider, targetLang, file, { signal });
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 406)) throw error;
      signal?.throwIfAborted();
      textOnlyProviders.add(provider);
      result = await client.translate(provider, targetLang, file, { signal, accept: "text/plain" });
    }
  }
  if (typeof result === "string") {
    return { kind: "text", text: result, name: translatedFileName(file.name, targetLang, textResultExtension(file)) };
  }
  if (result.size === 0) throw new Error("The translator returned an empty document.");
  const blob = result.type ? result : new Blob([result], { type: file.type || "application/octet-stream" });
  return { kind: "document", blob, name: translatedFileName(file.name, targetLang) };
}
