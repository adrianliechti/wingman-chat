import { getConfig } from "@/shared/config";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { getFileName } from "@/shared/lib/utils";

export async function runOcr(bytes: Uint8Array, path: string): Promise<string> {
  const config = getConfig();
  if (!config.extractor) {
    throw new Error("ocr: no document extraction service configured");
  }
  if (bytes.length === 0) {
    throw new Error(`ocr: file is empty: ${path}`);
  }

  // Ship the original filename and content type — the backend extractor
  // routes uploads by content type and rejects ones it cannot identify.
  const name = getFileName(path);
  const type = inferContentTypeFromPath(name);
  if (!type) {
    throw new Error(`ocr: cannot determine document type of ${name} — use a known file extension like .pdf or .docx`);
  }
  const text = await config.client.extractText(new File([bytes as BlobPart], name, { type }));
  console.debug(`ocr: ${path} (${type}, ${bytes.length} bytes) → ${text.length} chars`);
  return text;
}
