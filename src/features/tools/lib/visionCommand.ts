import { getConfig } from "@/shared/config";
import { bytesToDataUrl } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { getFileName } from "@/shared/lib/utils";
import { getTextFromContent, Role } from "@/shared/types/chat";
import { getModel } from "./llmCommand";

const DEFAULT_PROMPT =
  "Transcribe all text in this image verbatim, preserving the layout where possible. " +
  "If the image contains no text, describe its content in detail instead.";

export async function runVision(bytes: Uint8Array, path: string, prompt?: string): Promise<string> {
  const config = getConfig();
  if (!config.vision) {
    throw new Error("vision: no vision service configured");
  }
  // Configured vision model, or whatever model the chat currently uses.
  const model = config.vision.model || getModel();
  if (!model) {
    throw new Error("vision: no model");
  }
  if (bytes.length === 0) {
    throw new Error(`vision: file is empty: ${path}`);
  }

  const name = getFileName(path);
  const type = inferContentTypeFromPath(name);
  if (!type?.startsWith("image/")) {
    throw new Error(`vision: not an image: ${name} — use a known image extension like .png or .jpg`);
  }
  if (config.vision.files.length > 0 && !config.vision.files.includes(type)) {
    throw new Error(`vision: unsupported image type ${type} — supported: ${config.vision.files.join(", ")}`);
  }

  const result = await config.client.complete(
    model,
    "",
    [
      {
        role: Role.User,
        content: [
          { type: "image", name, data: bytesToDataUrl(bytes, type) },
          { type: "text", text: prompt?.trim() || DEFAULT_PROMPT },
        ],
      },
    ],
    [],
  );
  const text = getTextFromContent(result.content);
  console.debug(`vision: ${path} (${type}, ${bytes.length} bytes) → ${text.length} chars`);
  return text;
}
