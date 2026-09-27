import { getConfig } from "@/shared/config";
import { bytesToDataUrl } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { resolveVisionModel } from "@/shared/lib/modelSelection";
import { getFileName } from "@/shared/lib/utils";
import { completeIsolated, getModel } from "./llmCommand";
import type { BridgeRequestOptions } from "./workerHost";

const DEFAULT_PROMPT =
  "Transcribe all text in this image verbatim, preserving the layout where possible. " +
  "If the image contains no text, describe its content in detail instead.";

export async function runVision(
  bytes: Uint8Array,
  path: string,
  prompt?: string,
  requestOptions: BridgeRequestOptions = {},
): Promise<string> {
  requestOptions.signal?.throwIfAborted();
  requestOptions.context?.invocationContext?.signal?.throwIfAborted();
  const config = getConfig();
  if (bytes.length === 0) {
    throw new Error(`vision: file is empty: ${path}`);
  }

  const name = getFileName(path);
  const type = inferContentTypeFromPath(name);
  if (!type?.startsWith("image/")) {
    throw new Error(`vision: not an image: ${name} — use a known image extension like .png or .jpg`);
  }
  const files = config.vision?.files ?? [];
  if (files.length > 0 && !files.includes(type)) {
    throw new Error(`vision: unsupported image type ${type} — supported: ${files.join(", ")}`);
  }

  const model = await resolveVisionModel(config.vision?.model, requestOptions.context?.model || getModel());
  requestOptions.signal?.throwIfAborted();
  requestOptions.context?.invocationContext?.signal?.throwIfAborted();
  if (!model) throw new Error("vision: no image-capable chat model available");

  const text = await completeIsolated(
    model,
    [
      { type: "image", name, data: bytesToDataUrl(bytes, type) },
      { type: "text", text: prompt?.trim() || DEFAULT_PROMPT },
    ],
    {},
    requestOptions,
  );
  console.debug(`vision: ${path} (${type}, ${bytes.length} bytes) → ${text.length} chars`);
  return text;
}
