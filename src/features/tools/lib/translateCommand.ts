import { getConfig } from "@/shared/config";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { getFileName } from "@/shared/lib/utils";

function requireTranslator() {
  const config = getConfig();
  if (!config.translator) {
    throw new Error("translate: no translation service configured");
  }
  return config;
}

/** Translate plain text into `lang`; returns the translated text. */
export async function runTranslateText(lang: string, text: string): Promise<string> {
  const config = requireTranslator();
  if (!lang.trim()) {
    throw new Error("translate: no target language provided");
  }
  if (!text.trim()) {
    throw new Error("translate: no text provided");
  }
  const result = await config.client.translate(lang, text);
  // A text input should come back as text; decode defensively if the backend
  // returns a binary blob anyway.
  if (typeof result !== "string") {
    return new TextDecoder().decode(new Uint8Array(await result.arrayBuffer()));
  }
  return result;
}

/** Translate a whole file into `lang`; returns the translated file bytes. */
export async function runTranslateFile(lang: string, bytes: Uint8Array, path: string): Promise<Uint8Array> {
  const config = requireTranslator();
  if (!lang.trim()) {
    throw new Error("translate: no target language provided");
  }
  if (bytes.length === 0) {
    throw new Error(`translate: file is empty: ${path}`);
  }

  // Ship the original filename and content type so the backend routes the
  // upload by format, like the extractor does for `ocr`.
  const name = getFileName(path);
  const type = inferContentTypeFromPath(name) ?? "application/octet-stream";
  const file = new File([bytes as BlobPart], name, { type });

  const result = await config.client.translate(lang, file);
  // Some formats (e.g. plain text) come back as text rather than a file blob.
  if (typeof result === "string") {
    return new TextEncoder().encode(result);
  }
  const data = new Uint8Array(await result.arrayBuffer());
  if (data.length === 0) {
    throw new Error("translate: service returned an empty file");
  }
  return data;
}
